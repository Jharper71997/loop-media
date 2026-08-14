// Fleet-outage alarm: tells the operators when MANY screens stop at ONCE.
//
// Why this exists. On 2026-08-14 a single bad database reply made /api/tv/loop
// answer "404 device not paired", every screen polling in that window erased its
// own identity, and five venues went dark inside twenty seconds. Nobody found out
// for eight hours — because the only monitoring we had (lib/offlineAlerts) is
// per-screen, runs once a day, and emails the HOST. So during a platform failure
// it would have told five bar owners to go power-cycle a TV over our bug.
//
// The distinguishing signal is correlation, not count: independent TVs in
// different buildings cannot stop within seconds of each other by coincidence.
// One venue going dark is a venue problem. Three screens across two venues
// stopping inside the same ten minutes is OUR problem, and it is the operators
// who need the email.

import type { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { escapeHtml } from '@/lib/emailSettings'
import { adminRecipients } from '@/lib/notifyAdmin'
import { isWithinOpenHours } from '@/lib/openHours'

type Admin = ReturnType<typeof createAdminClient>

// Silent this long = stopped. Well past the 95s live threshold so a slow network
// or a missed beat or two never counts.
const STALE_AFTER_MS = 12 * 60 * 1000
// Only screens that stopped recently are news; a TV dark for a week is a separate
// (already known) problem and must not keep re-triggering the alarm.
const RECENT_WINDOW_MS = 6 * 60 * 60 * 1000
// Stops this close together are correlated — no plausible independent cause.
const CLUSTER_MS = 10 * 60 * 1000
// Below these, treat it as ordinary venue trouble and stay quiet.
const MIN_SCREENS = 3
const MIN_VENUES = 2
// One alarm per outage, not one per run.
const COOLDOWN_MS = 6 * 60 * 60 * 1000

type VenueHours = {
  id: string
  name: string
  business_open: string | null
  business_close: string | null
  business_days: number[] | null
  business_hours: Record<string, { open: string; close: string }> | null
}

type TvRow = {
  id: string
  device_id: string | null
  last_heartbeat_at: string | null
  venue: VenueHours | null
}

export type FleetOutage = {
  screens: Array<{ id: string; venue: string; stoppedAt: string }>
  venueCount: number
  /** First and last stop in the cluster — the tighter this is, the more damning. */
  from: string
  to: string
  spanSeconds: number
}

// A PostgREST embed arrives as an object or a one-element array depending on the
// relationship; normalise both.
function embedded(v: unknown): VenueHours | null {
  const rel = Array.isArray(v) ? v[0] : v
  const r = rel as VenueHours | null | undefined
  return typeof r?.id === 'string' && typeof r?.name === 'string' ? r : null
}

// Finds the largest group of screens that stopped within CLUSTER_MS of each
// other. Returns null when nothing looks correlated.
export async function detectFleetOutage(admin: Admin, now = Date.now()): Promise<FleetOutage | null> {
  const { data, error } = await admin
    .from('tvs')
    .select(
      'id, device_id, last_heartbeat_at, venue:venues(id, name, business_open, business_close, business_days, business_hours)'
    )
  // Never alarm on a failed read — that is the exact mistake that caused the
  // outage this alarm exists to catch.
  if (error) return null

  const stopped = ((data ?? []) as unknown as TvRow[])
    .filter((t) => t.device_id && t.last_heartbeat_at)
    .map((t) => ({
      id: t.id,
      venue: embedded(t.venue),
      at: Date.parse(t.last_heartbeat_at as string),
    }))
    .filter((t) => {
      const silent = now - t.at
      if (silent <= STALE_AFTER_MS || silent >= RECENT_WINDOW_MS) return false
      // A screen going quiet at closing time is a venue shutting off its TV, not
      // an outage — and venues keep similar hours, so several closing within the
      // same few minutes is exactly the correlated shape this alarm looks for.
      // Without this guard a normal evening would page the operators. Judge by
      // whether the venue was open WHEN IT STOPPED, not right now.
      const v = t.venue
      if (!v) return true
      return isWithinOpenHours(new Date(t.at).toISOString(), {
        business_open: v.business_open,
        business_close: v.business_close,
        business_days: v.business_days,
        business_hours: v.business_hours,
      })
    })
    .sort((a, b) => a.at - b.at)

  if (stopped.length < MIN_SCREENS) return null

  // Widest sliding window of stops within CLUSTER_MS, keeping the biggest.
  let best: typeof stopped = []
  for (let i = 0; i < stopped.length; i++) {
    let j = i
    while (j + 1 < stopped.length && stopped[j + 1].at - stopped[i].at <= CLUSTER_MS) j++
    const group = stopped.slice(i, j + 1)
    if (group.length > best.length) best = group
  }

  const venues = new Set(best.map((s) => s.venue?.id).filter(Boolean))
  if (best.length < MIN_SCREENS || venues.size < MIN_VENUES) return null

  const from = best[0].at
  const to = best[best.length - 1].at
  return {
    screens: best.map((s) => ({
      id: s.id,
      venue: s.venue?.name ?? 'Unknown venue',
      stoppedAt: new Date(s.at).toISOString(),
    })),
    venueCount: venues.size,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    spanSeconds: Math.round((to - from) / 1000),
  }
}

// True when we already alarmed recently, so an ongoing outage emails once.
async function recentlyAlarmed(admin: Admin, now: number): Promise<boolean> {
  const { data } = await admin
    .from('tv_alerts')
    .select('id')
    .eq('kind', 'fleet_outage')
    .gte('created_at', new Date(now - COOLDOWN_MS).toISOString())
    .limit(1)
    .maybeSingle()
  return !!data
}

function renderHtml(base: string, o: FleetOutage): string {
  const span =
    o.spanSeconds < 120
      ? `${o.spanSeconds} seconds`
      : `${Math.round(o.spanSeconds / 60)} minutes`
  const rows = o.screens
    .map(
      (s) =>
        `<tr><td style="padding:4px 14px 4px 0;color:#fafafa;font-size:13px;font-weight:600;">${escapeHtml(
          s.venue
        )}</td><td style="padding:4px 0;color:#a1a1aa;font-size:13px;font-family:ui-monospace,Menlo,monospace;">${escapeHtml(
          s.stoppedAt.replace('T', ' ').slice(0, 19)
        )} UTC</td></tr>`
    )
    .join('')
  return `<!doctype html><html><body style="margin:0;background:#09090b;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#0a0a0b;border:1px solid #27272a;border-radius:14px;overflow:hidden;">
      <tr><td style="padding:24px 28px;border-bottom:1px solid #27272a;">
        <div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#d4a333;font-weight:700;">Loop Network</div>
        <div style="margin-top:2px;color:#a1a1aa;font-size:13px;">Fleet alarm</div>
      </td></tr>
      <tr><td style="padding:24px 28px;">
        <div style="margin:0 0 10px;color:#fafafa;font-size:20px;font-weight:700;">${
          o.screens.length
        } screens stopped within ${escapeHtml(span)}</div>
        <p style="margin:0 0 18px;color:#a1a1aa;font-size:14px;line-height:1.55;">
          Across ${o.venueCount} venues. Screens in different buildings do not stop together by
          chance, so treat this as a platform fault, not venue trouble. Host emails are
          suppressed while this is active. Check the most recent deploy and the database first.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>
        <div style="margin-top:22px;"><a href="${base.replace(
          /\/$/,
          ''
        )}/admin/venues" style="display:inline-block;background:#d4a333;color:#0a0a0b;font-weight:700;font-size:14px;text-decoration:none;padding:11px 20px;border-radius:9px;">Open screens</a></div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

export type FleetAlarmResult = {
  outage: FleetOutage | null
  sent: number
  skipped?: string
}

export async function runFleetAlarm(
  admin: Admin,
  base: string,
  opts: { dry?: boolean } = {}
): Promise<FleetAlarmResult> {
  const now = Date.now()
  const outage = await detectFleetOutage(admin, now)
  if (!outage) return { outage: null, sent: 0 }
  if (opts.dry) return { outage, sent: 0, skipped: 'dry' }
  if (await recentlyAlarmed(admin, now)) return { outage, sent: 0, skipped: 'cooldown' }

  const to = await adminRecipients(admin)
  if (!to.length) return { outage, sent: 0, skipped: 'no-admin-recipients' }

  const send = await sendEmail({
    to,
    subject: `Loop Network: ${outage.screens.length} screens went dark at once`,
    html: renderHtml(base, outage),
  })
  // Record against every affected screen so the cooldown holds and the history
  // shows which screens were in the outage.
  await admin
    .from('tv_alerts')
    .insert(outage.screens.map((s) => ({ tv_id: s.id, kind: 'fleet_outage', sent_to: to.join(',') })))
  return { outage, sent: send.ok ? 1 : 0, skipped: send.ok ? undefined : 'email-skipped' }
}

// Host offline-screen alerts (shared core). Closes the detect->act gap: the
// platform knows a screen is offline in ~95s but never told the host. For each
// active venue with a host, this finds screens stale for a while WHILE THE VENUE
// IS OPEN (a dark screen at 3am is expected, not an incident) and emails the host
// to power-cycle the Fire Stick. Logged to tv_alerts so an ongoing outage emails
// once per cooldown, not every run.
//
// Extracted from the standalone /api/cron/offline-alerts route so the daily
// screen-live cron can run it too — Vercel Hobby caps the cron count, so we fold
// this into an existing daily cron instead of registering a 5th.

import type { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { resolveEmail, escapeHtml } from '@/lib/emailSettings'
import { isWithinOpenHours } from '@/lib/openHours'
import { detectFleetOutage } from '@/lib/fleetAlarm'

type Admin = ReturnType<typeof createAdminClient>

// Stale this long during open hours = treat as offline (a brief blip won't alert).
const OFFLINE_AFTER_MS = 30 * 60 * 1000
// At most one alert per screen per this window, so an ongoing outage emails once.
const COOLDOWN_MS = 12 * 60 * 60 * 1000

function renderHtml(
  base: string,
  hostName: string | null,
  heading: string,
  bodyParas: string[]
): string {
  const greeting = hostName ? `Hi ${escapeHtml(hostName.split(' ')[0])},` : 'Hi,'
  const dash = `${base.replace(/\/$/, '')}/host`
  const paras = [greeting, ...bodyParas.map((p) => escapeHtml(p))]
    .map(
      (p) => `<p style="font-size:16px;line-height:1.5;color:#cfcfcf;margin:0 0 20px">${p}</p>`
    )
    .join('')
  return `<!doctype html><html><body style="margin:0;background:#0a0a0b;font-family:Arial,Helvetica,sans-serif;color:#fff">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="font-size:13px;letter-spacing:2px;color:#d4af37;text-transform:uppercase">Loop Network</div>
    <h1 style="font-size:22px;margin:16px 0 8px">${escapeHtml(heading)}</h1>
    ${paras}
    <a href="${dash}" style="display:inline-block;background:#d4af37;color:#000;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:10px">
      Open your dashboard
    </a>
    <p style="font-size:12px;color:#777;margin-top:28px">If it is already back on, thank you and please ignore this.</p>
  </div></body></html>`
}

type VenueRow = {
  id: string
  name: string
  host_user_id: string | null
  business_open: string | null
  business_close: string | null
  business_days: number[] | null
  business_hours: Record<string, { open: string; close: string }> | null
  tvs: { id: string; last_heartbeat_at: string | null }[]
}

export type OfflineAlertsResult = {
  ran: number
  sent: number
  skipped?: string
  results?: Array<{ tv: string; venue: string; status: string }>
}

export async function runOfflineAlerts(
  admin: Admin,
  base: string,
  opts: { dry?: boolean; onlyVenue?: string | null } = {}
): Promise<OfflineAlertsResult> {
  const dry = opts.dry ?? false
  const onlyVenue = opts.onlyVenue ?? null
  const now = Date.now()

  // Admin on/off gate for this email.
  if (!dry && !(await resolveEmail(admin, 'screen_offline', {})).enabled) {
    return { ran: 0, sent: 0, skipped: 'screen_offline disabled' }
  }

  // Never blame the host for our own outage. When screens across several venues
  // stop within minutes of each other the cause is the platform, and this email
  // would send a bar owner to go power-cycle a TV that is working fine. The
  // operators get the fleet alarm instead (lib/fleetAlarm); hosts hear nothing.
  if (!dry && (await detectFleetOutage(admin, now))) {
    return { ran: 0, sent: 0, skipped: 'fleet outage — host alerts suppressed' }
  }

  let vq = admin
    .from('venues')
    .select(
      'id, name, host_user_id, business_open, business_close, business_days, business_hours, tvs(id, last_heartbeat_at)'
    )
    .eq('status', 'active')
    .not('host_user_id', 'is', null)
  if (onlyVenue) vq = vq.eq('id', onlyVenue)
  const { data: venues } = await vq

  const results: Array<{ tv: string; venue: string; status: string }> = []
  const hostEmail = new Map<string, { email: string; full_name: string | null } | null>()

  for (const v of (venues ?? []) as unknown as VenueRow[]) {
    const hours = {
      business_open: v.business_open,
      business_close: v.business_close,
      business_days: v.business_days,
      business_hours: v.business_hours,
    }
    // Only alert while the venue is actually open — a dark screen when closed is fine.
    if (!isWithinOpenHours(new Date(now).toISOString(), hours)) continue

    for (const tv of v.tvs ?? []) {
      const last = tv.last_heartbeat_at ? Date.parse(tv.last_heartbeat_at) : 0
      const stale = now - last > OFFLINE_AFTER_MS
      if (!stale) continue

      // Cooldown: skip if we alerted this screen recently.
      const { data: recent } = await admin
        .from('tv_alerts')
        .select('id')
        .eq('tv_id', tv.id)
        .gte('created_at', new Date(now - COOLDOWN_MS).toISOString())
        .limit(1)
        .maybeSingle()
      if (recent) {
        results.push({ tv: tv.id, venue: v.id, status: 'cooldown' })
        continue
      }

      if (!v.host_user_id) continue
      let host = hostEmail.get(v.host_user_id)
      if (host === undefined) {
        const { data } = await admin
          .from('profiles')
          .select('email, full_name')
          .eq('id', v.host_user_id)
          .maybeSingle()
        host = data?.email
          ? { email: data.email as string, full_name: (data.full_name as string | null) ?? null }
          : null
        hostEmail.set(v.host_user_id, host)
      }
      if (!host) {
        results.push({ tv: tv.id, venue: v.id, status: 'no-host-email' })
        continue
      }

      if (dry) {
        results.push({ tv: tv.id, venue: v.id, status: 'dry' })
        continue
      }

      const resolved = await resolveEmail(admin, 'screen_offline', { venue: v.name })
      const send = await sendEmail({
        to: host.email,
        subject: resolved.subject,
        html: renderHtml(base, host.full_name, resolved.heading, resolved.body),
      })
      await admin.from('tv_alerts').insert({ tv_id: tv.id, kind: 'offline', sent_to: host.email })
      results.push({ tv: tv.id, venue: v.id, status: send.ok ? 'sent' : 'email-skipped' })
    }
  }

  return {
    ran: results.length,
    sent: results.filter((r) => r.status === 'sent').length,
    results,
  }
}

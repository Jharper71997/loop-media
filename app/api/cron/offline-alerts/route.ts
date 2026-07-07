import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { appUrl } from '@/lib/stripe'
import { sendEmail } from '@/lib/email'
import { isWithinOpenHours } from '@/lib/openHours'

// Host offline-screen alerts. Closes the detect->act gap: the platform knows a
// screen is offline in ~95s but never told the host. For each active venue with a
// host, this finds screens that have been stale for a while WHILE THE VENUE IS OPEN
// (a dark screen at 3am is expected, not an incident) and emails the host so they
// can power-cycle the Fire Stick. Logged to tv_alerts so a screen that stays down
// doesn't re-email every run (one alert per screen per cooldown).
//
// NOT registered in vercel.json on purpose — Vercel Hobby caps cron count and a
// 5th daily cron can silently break deploys. Run it by hand, or fold the loop into
// the existing daily screen-live cron once the Vercel plan is confirmed:
//   curl -H "Authorization: Bearer $CRON_SECRET" ".../api/cron/offline-alerts?dry=1"
//   ...&venue=<id>   limit to one venue
export const dynamic = 'force-dynamic'

// Stale this long during open hours = treat as offline (a brief blip won't alert).
const OFFLINE_AFTER_MS = 30 * 60 * 1000
// At most one alert per screen per this window, so an ongoing outage emails once.
const COOLDOWN_MS = 12 * 60 * 60 * 1000

function renderHtml(venueName: string, base: string, hostName: string | null): string {
  const greeting = hostName ? `Hi ${hostName.split(' ')[0]},` : 'Hi,'
  const dash = `${base.replace(/\/$/, '')}/host`
  return `<!doctype html><html><body style="margin:0;background:#0a0a0b;font-family:Arial,Helvetica,sans-serif;color:#fff">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="font-size:13px;letter-spacing:2px;color:#d4af37;text-transform:uppercase">Loop Network</div>
    <h1 style="font-size:22px;margin:16px 0 8px">Your screen looks offline</h1>
    <p style="font-size:16px;line-height:1.5;color:#cfcfcf;margin:0 0 20px">
      ${greeting}<br/>The Loop screen at <strong style="color:#fff">${venueName}</strong> has not
      checked in for a little while during your open hours. It is usually a quick fix: unplug the
      Fire Stick, wait a few seconds, plug it back in, and make sure the TV input is on Loop.
    </p>
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
  tvs: { id: string; last_heartbeat_at: string | null }[]
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === '1'
  const onlyVenue = url.searchParams.get('venue')

  const admin = createAdminClient()
  const base = appUrl()
  const now = Date.now()

  let vq = admin
    .from('venues')
    .select(
      'id, name, host_user_id, business_open, business_close, business_days, tvs(id, last_heartbeat_at)'
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

      // Resolve (and cache) the host's email.
      if (!v.host_user_id) continue
      let host = hostEmail.get(v.host_user_id)
      if (host === undefined) {
        const { data } = await admin
          .from('profiles')
          .select('email, full_name')
          .eq('id', v.host_user_id)
          .maybeSingle()
        host = data?.email ? { email: data.email as string, full_name: (data.full_name as string | null) ?? null } : null
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

      const send = await sendEmail({
        to: host.email,
        subject: `Your Loop screen at ${v.name} looks offline`,
        html: renderHtml(v.name, base, host.full_name),
      })
      await admin.from('tv_alerts').insert({ tv_id: tv.id, kind: 'offline', sent_to: host.email })
      results.push({ tv: tv.id, venue: v.id, status: send.ok ? 'sent' : 'email-skipped' })
    }
  }

  return NextResponse.json({
    ran: results.length,
    sent: results.filter((r) => r.status === 'sent').length,
    results,
  })
}

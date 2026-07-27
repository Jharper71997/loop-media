import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { appUrl } from '@/lib/stripe'
import { sendEmail } from '@/lib/email'
import { resolveEmail, escapeHtml } from '@/lib/emailSettings'
import { runOfflineAlerts } from '@/lib/offlineAlerts'

// "A new screen just went live near you" announcement — two emails, one trigger.
//
// Trigger: a venue's screen has checked in for the FIRST time (it has ever
// heartbeated) and the venue is approved (active). We announce it once, then
// log it so it's never re-announced. The 0026 migration backfills already-live
// venues, so this only fires for screens that go live going forward.
//
// Advertiser audience (deduped by email):
//   - advertisers who tapped "Notify me" on this venue (venue_waitlist)
//   - advertisers with a campaign in this venue's market (campaigns.territory_id)
//   - advertisers whose home market is this territory (profiles.territory_id)
//
// Host audience: the hosts of the OTHER active venues in this territory — the
// network growing near them means more advertisers on their screen too. The new
// venue's own host is excluded (they'd be hearing about themselves).
//
// The two emails toggle independently in /admin/email (screen_live and
// host_screen_live), and each recipient gets an individual email so the list
// isn't exposed.
//
// DAILY cron (Vercel Hobby allows only daily schedules). Protected by
// CRON_SECRET (Vercel sends it as Bearer).
// Manual / test run:
//   curl -H "Authorization: Bearer $CRON_SECRET" ".../api/cron/screen-live?dry=1"
//   ...&venue=<id>   limit to one venue
export const dynamic = 'force-dynamic'

// Heading + body come from email_settings (admin-editable); CTA and footer stay
// code-owned. Body paragraphs arrive as plain text and are escaped before render.
function renderHtml(base: string, heading: string, bodyParas: string[]): string {
  const browse = `${base.replace(/\/$/, '')}/advertiser/browse`
  const paras = bodyParas
    .map(
      (p) =>
        `<p style="font-size:16px;line-height:1.5;color:#cfcfcf;margin:0 0 24px">${escapeHtml(p)}</p>`
    )
    .join('')
  return `<!doctype html><html><body style="margin:0;background:#0a0a0b;font-family:Arial,Helvetica,sans-serif;color:#fff">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="font-size:13px;letter-spacing:2px;color:#d4af37;text-transform:uppercase">Loop Network</div>
    <h1 style="font-size:24px;margin:16px 0 8px">${escapeHtml(heading)}</h1>
    ${paras}
    <a href="${browse}" style="display:inline-block;background:#d4af37;color:#000;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:10px">
      See it on the map
    </a>
    <p style="font-size:12px;color:#777;margin-top:32px">You're getting this because you advertise on Loop Network in this market.</p>
  </div></body></html>`
}

// Host version of the same announcement: personalized greeting and a CTA to the
// host dashboard instead of the advertiser map (mirrors lib/offlineAlerts).
function renderHostHtml(
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
    <p style="font-size:12px;color:#777;margin-top:28px">You're getting this because you host a Loop Network screen in this market.</p>
  </div></body></html>`
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

  // Folded-in host offline-screen alerts (run on this daily cron to respect the
  // Hobby cron cap — see lib/offlineAlerts). Independent of the screen-live email
  // below; a failure here must never block it.
  let offline: unknown = null
  try {
    offline = await runOfflineAlerts(admin, base, { dry, onlyVenue })
  } catch {
    offline = { ran: 0, sent: 0, skipped: 'error' }
  }

  // Admin on/off gates. The advertiser announcement and the host one toggle
  // independently, so only bail when BOTH are off (a venue stays un-announced
  // until at least one of them can go out).
  const advOn = dry || (await resolveEmail(admin, 'screen_live', {})).enabled
  const hostOn = dry || (await resolveEmail(admin, 'host_screen_live', {})).enabled
  if (!advOn && !hostOn) {
    return NextResponse.json({ ran: 0, sent: 0, skipped: 'screen_live disabled', offline })
  }

  // Venue ids whose screen has ever checked in (so it's real + live).
  const { data: liveTvs } = await admin
    .from('tvs')
    .select('venue_id')
    .not('last_heartbeat_at', 'is', null)
  const everLive = [...new Set((liveTvs ?? []).map((t) => t.venue_id as string))]
  if (!everLive.length) return NextResponse.json({ ran: 0, sent: 0, results: [], offline })

  // Venues we've already announced.
  const { data: announced } = await admin.from('venue_live_notice_log').select('venue_id')
  const announcedSet = new Set((announced ?? []).map((r) => r.venue_id as string))

  // Approved, ever-live, not-yet-announced venues.
  let vq = admin
    .from('venues')
    .select('id, name, city, territory_id, host_user_id')
    .eq('status', 'active')
    .in('id', everLive)
  if (onlyVenue) vq = vq.eq('id', onlyVenue)
  const { data: venues } = await vq
  const todo = (venues ?? []).filter((v) => !announcedSet.has(v.id as string))

  const results: Array<{
    venue: string
    status: string
    recipients: number
    hostRecipients: number
  }> = []

  for (const v of todo) {
    const venue = v as {
      id: string
      name: string
      city: string | null
      territory_id: string
      host_user_id: string | null
    }
    const vars = { venue: venue.name, city: venue.city || 'your area' }

    // Advertiser audience: union of three sources, deduped by advertiser id.
    const advIds = new Set<string>()
    const [{ data: wl }, { data: camps }, { data: locals }] = await Promise.all([
      admin.from('venue_waitlist').select('advertiser_id').eq('venue_id', venue.id),
      admin.from('campaigns').select('advertiser_id').eq('territory_id', venue.territory_id),
      admin
        .from('profiles')
        .select('id')
        .eq('role', 'advertiser')
        .eq('territory_id', venue.territory_id),
    ])
    for (const r of wl ?? []) advIds.add(r.advertiser_id as string)
    for (const r of camps ?? []) advIds.add(r.advertiser_id as string)
    for (const r of locals ?? []) advIds.add(r.id as string)

    let emails: string[] = []
    if (advOn && advIds.size) {
      const { data: profs } = await admin.from('profiles').select('email').in('id', [...advIds])
      emails = [...new Set((profs ?? []).map((p) => p.email as string).filter(Boolean))]
    }

    // Host audience: hosts of the other active venues in this market. The new
    // venue's own host is skipped even if they host elsewhere in the territory.
    const hosts: Array<{ email: string; full_name: string | null }> = []
    if (hostOn) {
      const { data: sibling } = await admin
        .from('venues')
        .select('host_user_id')
        .eq('territory_id', venue.territory_id)
        .eq('status', 'active')
        .neq('id', venue.id)
        .not('host_user_id', 'is', null)
      const hostIds = [...new Set((sibling ?? []).map((r) => r.host_user_id as string))].filter(
        (id) => id !== venue.host_user_id
      )
      if (hostIds.length) {
        const { data: profs } = await admin
          .from('profiles')
          .select('email, full_name')
          .in('id', hostIds)
        const seen = new Set<string>()
        for (const p of profs ?? []) {
          const email = p.email as string | null
          if (!email || seen.has(email)) continue
          seen.add(email)
          hosts.push({ email, full_name: (p.full_name as string | null) ?? null })
        }
      }
    }

    if (dry) {
      results.push({
        venue: venue.id,
        status: 'dry',
        recipients: emails.length,
        hostRecipients: hosts.length,
      })
      continue
    }

    let sent = 0
    if (emails.length) {
      const resolved = await resolveEmail(admin, 'screen_live', vars)
      const html = renderHtml(base, resolved.heading, resolved.body)
      for (const to of emails) {
        const res = await sendEmail({ to, subject: resolved.subject, html })
        if (res.ok) sent++
      }

      // Waitlisters only count as notified when the advertiser email actually went out.
      await admin
        .from('venue_waitlist')
        .update({ notified_at: new Date().toISOString() })
        .eq('venue_id', venue.id)
        .is('notified_at', null)
    }

    let hostSent = 0
    if (hosts.length) {
      const resolved = await resolveEmail(admin, 'host_screen_live', vars)
      for (const host of hosts) {
        const res = await sendEmail({
          to: host.email,
          subject: resolved.subject,
          html: renderHostHtml(base, host.full_name, resolved.heading, resolved.body),
        })
        if (res.ok) hostSent++
      }
    }

    // Log the venue so it's never re-announced (to either audience).
    await admin
      .from('venue_live_notice_log')
      .upsert({ venue_id: venue.id, sent_count: sent + hostSent }, { onConflict: 'venue_id' })

    results.push({
      venue: venue.id,
      status: emails.length || hosts.length ? 'sent' : 'no-recipients',
      recipients: sent,
      hostRecipients: hostSent,
    })
  }

  return NextResponse.json({
    ran: results.length,
    sent: results.filter((r) => r.status === 'sent').length,
    advertiserEmails: results.reduce((n, r) => n + r.recipients, 0),
    hostEmails: results.reduce((n, r) => n + r.hostRecipients, 0),
    results,
    offline,
  })
}

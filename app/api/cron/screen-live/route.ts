import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { appUrl } from '@/lib/stripe'
import { sendEmail } from '@/lib/email'
import { resolveEmail, escapeHtml } from '@/lib/emailSettings'

// "A new screen just went live near you" advertiser email.
//
// Trigger: a venue's screen has checked in for the FIRST time (it has ever
// heartbeated) and the venue is approved (active). We announce it once, then
// log it so it's never re-announced. The 0026 migration backfills already-live
// venues, so this only fires for screens that go live going forward.
//
// Audience (deduped by email):
//   - advertisers who tapped "Notify me" on this venue (venue_waitlist)
//   - advertisers with a campaign in this venue's market (campaigns.territory_id)
//   - advertisers whose home market is this territory (profiles.territory_id)
// Each gets an individual email so the recipient list isn't exposed.
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

  // Admin on/off gate for this email.
  if (!dry && !(await resolveEmail(admin, 'screen_live', {})).enabled) {
    return NextResponse.json({ ran: 0, sent: 0, skipped: 'screen_live disabled' })
  }

  // Venue ids whose screen has ever checked in (so it's real + live).
  const { data: liveTvs } = await admin
    .from('tvs')
    .select('venue_id')
    .not('last_heartbeat_at', 'is', null)
  const everLive = [...new Set((liveTvs ?? []).map((t) => t.venue_id as string))]
  if (!everLive.length) return NextResponse.json({ ran: 0, sent: 0, results: [] })

  // Venues we've already announced.
  const { data: announced } = await admin.from('venue_live_notice_log').select('venue_id')
  const announcedSet = new Set((announced ?? []).map((r) => r.venue_id as string))

  // Approved, ever-live, not-yet-announced venues.
  let vq = admin
    .from('venues')
    .select('id, name, city, territory_id')
    .eq('status', 'active')
    .in('id', everLive)
  if (onlyVenue) vq = vq.eq('id', onlyVenue)
  const { data: venues } = await vq
  const todo = (venues ?? []).filter((v) => !announcedSet.has(v.id as string))

  const results: Array<{ venue: string; status: string; recipients: number }> = []

  for (const v of todo) {
    const venue = v as { id: string; name: string; city: string | null; territory_id: string }

    // Build the audience: union of three sources, deduped by advertiser id.
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
    if (advIds.size) {
      const { data: profs } = await admin.from('profiles').select('email').in('id', [...advIds])
      emails = [...new Set((profs ?? []).map((p) => p.email as string).filter(Boolean))]
    }

    if (dry) {
      results.push({ venue: venue.id, status: 'dry', recipients: emails.length })
      continue
    }

    let sent = 0
    const resolved = await resolveEmail(admin, 'screen_live', {
      venue: venue.name,
      city: venue.city || 'your area',
    })
    const html = renderHtml(base, resolved.heading, resolved.body)
    const subject = resolved.subject
    for (const to of emails) {
      const res = await sendEmail({ to, subject, html })
      if (res.ok) sent++
    }

    // Mark waitlisters notified, and log the venue so it's never re-announced.
    await admin
      .from('venue_waitlist')
      .update({ notified_at: new Date().toISOString() })
      .eq('venue_id', venue.id)
      .is('notified_at', null)
    await admin
      .from('venue_live_notice_log')
      .upsert({ venue_id: venue.id, sent_count: sent }, { onConflict: 'venue_id' })

    results.push({ venue: venue.id, status: emails.length ? 'sent' : 'no-recipients', recipients: sent })
  }

  return NextResponse.json({
    ran: results.length,
    sent: results.filter((r) => r.status === 'sent').length,
    results,
  })
}

// A host's screen off for 3+ days: their free ads come off, and come back when
// the screen does.
//
// Hosts advertise free because they keep a screen on for us. When that screen
// has not checked in for three days, the host's own ads are paused on every
// screen and the host gets ONE email saying so, with what to do about it. The
// moment the screen checks in again (see restoreHostAdsForTv, called from the
// heartbeat route) the ads go back on. This replaced the daily "your screen
// looks offline" nudge, which fired from the first 30 minutes and every day.
//
// What counts as the host's own ad: an ad they own, or one marked as their host
// ad (ads.host_venue_id, "Mark as host ad" in the admin). An ad on a campaign
// with a recorded payment is theirs as a paying advertiser, not a host, and is
// never touched.
//
// The record is tv_alerts, no new table:
//   kind 'host_ads_pulled'   one per outage, on the dark screen; sent_to = host
//   kind 'host_ads_restored' written when that screen came back
//   kind 'offline_3d'        a host with no ads to pull, emailed once per outage
// An outage is "the same one" while the screen's last heartbeat is still older
// than the record, so a screen that comes back and dies again starts fresh.
//
// Restore only un-pauses placements this pulled: paused, on the host's ads, on a
// campaign that is not itself paused or ended, for an owner not on hold. Those
// are the other two things that pause a placement, and neither is ours to undo.

import type { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { resolveEmail, escapeHtml, type EmailKey } from '@/lib/emailSettings'
import { detectFleetOutage } from '@/lib/fleetAlarm'

type Admin = ReturnType<typeof createAdminClient>

export const OFF_AFTER_DAYS = 3
const OFF_AFTER_MS = OFF_AFTER_DAYS * 86_400_000
// If this share of connected screens is dark at once, it is us, not the hosts.
const PLATFORM_FAULT_SHARE = 0.5

type Tv = { id: string; last_heartbeat_at: string | null }
type Venue = { id: string; name: string; host_user_id: string; is_demo: boolean; tvs: Tv[] | null }

export type HostScreenOffResult = {
  skipped?: string
  pulled: { host: string; venue: string; ads: number; placements: number; email: string }[]
  emailedNoAds: { host: string; venue: string; email: string }[]
  restored: { venue: string; placements: number }[]
}

function renderHtml(base: string, hostName: string | null, heading: string, body: string[]): string {
  const greeting = hostName ? `Hi ${escapeHtml(hostName.split(' ')[0])},` : 'Hi,'
  const dash = `${base.replace(/\/$/, '')}/host`
  const paras = [greeting, ...body.map((p) => escapeHtml(p))]
    .map((p) => `<p style="font-size:16px;line-height:1.5;color:#cfcfcf;margin:0 0 20px">${p}</p>`)
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

/** The host's own ads: owned by them, or marked as their host ad. Paid ones excluded. */
async function hostAdIds(admin: Admin, hostId: string, venueIds: string[]): Promise<string[]> {
  const [{ data: owned }, { data: marked }] = await Promise.all([
    admin.from('ads').select('id').eq('owner_user_id', hostId),
    venueIds.length
      ? admin.from('ads').select('id').in('host_venue_id', venueIds)
      : Promise.resolve({ data: [] as { id: string }[] }),
  ])
  const ids = [...new Set([...(owned ?? []), ...(marked ?? [])].map((a) => a.id))]
  if (!ids.length) return []
  // A recorded payment means this ad is bought, not a host perk.
  const { data: paid } = await admin
    .from('campaigns')
    .select('ad_id, payments!inner(id)')
    .in('ad_id', ids)
  const paidAds = new Set(((paid ?? []) as { ad_id: string }[]).map((c) => c.ad_id))
  return ids.filter((id) => !paidAds.has(id))
}

async function isOnHold(admin: Admin, userId: string): Promise<boolean> {
  const { data } = await admin.auth.admin.getUserById(userId)
  const banned = (data?.user as { banned_until?: string | null } | undefined)?.banned_until
  return !!banned && new Date(banned).getTime() > Date.now()
}

async function send(
  admin: Admin,
  base: string,
  key: EmailKey,
  host: { email: string; full_name: string | null },
  venue: string
) {
  const r = await resolveEmail(admin, key, { venue, days: String(OFF_AFTER_DAYS) })
  if (!r.enabled) return
  await sendEmail({
    to: host.email,
    subject: r.subject,
    html: renderHtml(base, host.full_name, r.heading, r.body),
  })
}

/**
 * Put a host's ads back once `tvId` (one of their screens) is checking in again.
 * Safe to call any number of times; only acts when an open pull exists.
 */
export async function restoreHostAdsForTv(admin: Admin, tvId: string): Promise<number> {
  const { data: pulls } = await admin
    .from('tv_alerts')
    .select('id, created_at')
    .eq('tv_id', tvId)
    .eq('kind', 'host_ads_pulled')
    .order('created_at', { ascending: false })
    .limit(1)
  const pull = pulls?.[0]
  if (!pull) return 0
  const { data: done } = await admin
    .from('tv_alerts')
    .select('id')
    .eq('tv_id', tvId)
    .eq('kind', 'host_ads_restored')
    .gte('created_at', pull.created_at)
    .limit(1)
  if (done?.length) return 0

  const { data: tv } = await admin
    .from('tvs')
    .select('venue:venues(host_user_id)')
    .eq('id', tvId)
    .maybeSingle()
  const venue = Array.isArray(tv?.venue) ? tv?.venue[0] : tv?.venue
  const hostId = (venue as { host_user_id: string | null } | null)?.host_user_id
  if (!hostId) return 0

  // Another of their screens still dark 3+ days keeps the ads off.
  const { data: theirVenues } = await admin
    .from('venues')
    .select('id, tvs(id, last_heartbeat_at)')
    .eq('host_user_id', hostId)
  const venueIds = ((theirVenues ?? []) as { id: string; tvs: Tv[] | null }[]).map((v) => v.id)
  const stillDark = ((theirVenues ?? []) as { tvs: Tv[] | null }[])
    .flatMap((v) => v.tvs ?? [])
    .some(
      (t) =>
        t.id !== tvId &&
        !!t.last_heartbeat_at &&
        Date.now() - Date.parse(t.last_heartbeat_at) > OFF_AFTER_MS
    )
  if (stillDark) return 0

  const adIds = await hostAdIds(admin, hostId, venueIds)
  let restored = 0
  if (adIds.length) {
    const { data: paused } = await admin
      .from('ad_placements')
      .select('id, ad:ads(owner_user_id), campaign:campaigns(status, deleted_at)')
      .eq('status', 'paused')
      .in('ad_id', adIds)
    const holdCache = new Map<string, boolean>()
    const ids: string[] = []
    for (const p of (paused ?? []) as unknown as {
      id: string
      ad: { owner_user_id: string } | { owner_user_id: string }[] | null
      campaign: { status: string; deleted_at: string | null } | { status: string; deleted_at: string | null }[] | null
    }[]) {
      const c = Array.isArray(p.campaign) ? p.campaign[0] : p.campaign
      if (c && (c.deleted_at || c.status !== 'active')) continue // paused/ended by someone else
      const owner = (Array.isArray(p.ad) ? p.ad[0] : p.ad)?.owner_user_id
      if (owner) {
        if (!holdCache.has(owner)) holdCache.set(owner, await isOnHold(admin, owner))
        if (holdCache.get(owner)) continue
      }
      ids.push(p.id)
    }
    if (ids.length) {
      await admin.from('ad_placements').update({ status: 'active' }).in('id', ids)
      restored = ids.length
    }
  }
  await admin.from('tv_alerts').insert({ tv_id: tvId, kind: 'host_ads_restored', sent_to: null })
  return restored
}

export async function runHostScreenOff(
  admin: Admin,
  base: string,
  opts: { dry?: boolean } = {}
): Promise<HostScreenOffResult> {
  const dry = opts.dry ?? false
  const now = Date.now()
  const out: HostScreenOffResult = { pulled: [], emailedNoAds: [], restored: [] }

  // One switch for the whole thing: turning this email off in /admin/email also
  // stops ads being pulled, so there is never a silent pull.
  if (!dry && !(await resolveEmail(admin, 'host_screen_off', {})).enabled) {
    return { ...out, skipped: 'host_screen_off disabled' }
  }

  const { data: vData, error } = await admin
    .from('venues')
    .select('id, name, host_user_id, is_demo, tvs(id, last_heartbeat_at)')
    .not('host_user_id', 'is', null)
  if (error) return { ...out, skipped: 'venue read failed' }
  const venues = ((vData ?? []) as unknown as Venue[]).filter((v) => !v.is_demo)

  // Screens that have ever connected; a never-paired screen was never "on".
  const connected = venues.flatMap((v) => (v.tvs ?? []).filter((t) => t.last_heartbeat_at))
  const isDark = (t: Tv) => !!t.last_heartbeat_at && now - Date.parse(t.last_heartbeat_at) > OFF_AFTER_MS

  // Never punish hosts for our outage.
  const darkShare = connected.length ? connected.filter(isDark).length / connected.length : 0
  if (darkShare >= PLATFORM_FAULT_SHARE) return { ...out, skipped: `platform fault: ${Math.round(darkShare * 100)}% dark` }
  if (!dry && (await detectFleetOutage(admin, now))) return { ...out, skipped: 'fleet outage' }

  // Catch-up restore for any screen that came back since (the heartbeat route
  // does this instantly; this covers a missed call).
  const { data: openPulls } = await admin
    .from('tv_alerts')
    .select('tv_id')
    .eq('kind', 'host_ads_pulled')
    .gte('created_at', new Date(now - 90 * 86_400_000).toISOString())
  const venueByTv = new Map(venues.flatMap((v) => (v.tvs ?? []).map((t) => [t.id, v] as const)))
  const tvById = new Map(connected.map((t) => [t.id, t]))
  for (const tvId of new Set((openPulls ?? []).map((p) => p.tv_id))) {
    const tv = tvById.get(tvId)
    if (!tv || isDark(tv)) continue
    if (dry) continue
    const n = await restoreHostAdsForTv(admin, tvId)
    if (n) out.restored.push({ venue: venueByTv.get(tvId)?.name ?? tvId, placements: n })
  }

  const byHost = new Map<string, Venue[]>()
  for (const v of venues) byHost.set(v.host_user_id, [...(byHost.get(v.host_user_id) ?? []), v])

  for (const [hostId, theirs] of byHost) {
    const dark = theirs.flatMap((v) => (v.tvs ?? []).filter(isDark).map((t) => ({ tv: t, venue: v })))
    if (!dark.length) continue
    const first = dark[0]

    // Already handled this outage? A record newer than the last heartbeat.
    const { data: prior } = await admin
      .from('tv_alerts')
      .select('id')
      .in('tv_id', dark.map((d) => d.tv.id))
      .in('kind', ['host_ads_pulled', 'offline_3d'])
      .gte('created_at', first.tv.last_heartbeat_at!)
      .limit(1)
    if (prior?.length) continue

    const { data: profile } = await admin
      .from('profiles')
      .select('email, full_name')
      .eq('id', hostId)
      .maybeSingle()
    const host = profile?.email
      ? { email: profile.email as string, full_name: (profile.full_name as string | null) ?? null }
      : null

    const adIds = await hostAdIds(admin, hostId, theirs.map((v) => v.id))
    const { data: live } = adIds.length
      ? await admin.from('ad_placements').select('id').eq('status', 'active').in('ad_id', adIds)
      : { data: [] as { id: string }[] }
    const placementIds = (live ?? []).map((p) => p.id)

    if (placementIds.length) {
      out.pulled.push({
        host: host?.full_name ?? host?.email ?? hostId,
        venue: first.venue.name,
        ads: adIds.length,
        placements: placementIds.length,
        email: host?.email ?? '(no email)',
      })
      if (dry) continue
      await admin.from('ad_placements').update({ status: 'paused' }).in('id', placementIds)
      await admin.from('tv_alerts').insert({ tv_id: first.tv.id, kind: 'host_ads_pulled', sent_to: host?.email ?? null })
      if (host) await send(admin, base, 'host_screen_off', host, first.venue.name)
    } else {
      // Nothing of theirs to pull: still tell them, once, that the screen is off.
      if (!host) continue
      out.emailedNoAds.push({ host: host.full_name ?? host.email, venue: first.venue.name, email: host.email })
      if (dry) continue
      await admin.from('tv_alerts').insert({ tv_id: first.tv.id, kind: 'offline_3d', sent_to: host.email })
      await send(admin, base, 'screen_offline', host, first.venue.name)
    }
  }
  return out
}

import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, CONTENT_TABS } from '@/components/admin/SectionTabs'
import type { Ad } from '@/lib/db.types'
import { QueueBoard, type QueueItem } from './QueueBoard'

type QueueAd = Ad & {
  owner: { full_name: string | null; email: string; phone: string | null } | null
  category: { name: string } | null
  territory: { name: string } | null
}

// Ask storage how big the creative actually is and what it really is, without
// downloading it. Size and container are the two things that decide whether a
// spot airs at all (a Fire Stick stalls on a fat file and skips a codec it can't
// decode), and neither is recorded on the ad row — so the reviewer can only find
// out here. Best effort: a probe that fails just leaves the card without a size.
async function probeCreative(url: string) {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const len = res.headers.get('content-length')
    return {
      bytes: len ? Number(len) : null,
      type: res.headers.get('content-type'),
    }
  } catch {
    return null
  }
}

export default async function QueuePage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  let q = supabase
    .from('ads')
    .select(
      '*, owner:profiles!owner_user_id(full_name, email, phone), category:categories(name), territory:territories(name)'
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (t) q = q.eq('territory_id', t)
  const { data } = await q
  const ads = (data ?? []) as QueueAd[]

  // Decision context: is there a paid (active) campaign behind each ad, and who's
  // the advertiser to link to. A pending ad on an active campaign was paid for;
  // one on a draft campaign hasn't been.
  const adIds = ads.map((a) => a.id)
  const paidByAd = new Map<string, boolean>()
  const advertiserByAd = new Map<string, string>()
  const adByCampaign = new Map<string, string>()
  const campaignByAd = new Map<string, { id: string; status: string; monthlyCents: number | null }>()
  if (adIds.length) {
    const { data: camps } = await supabase
      .from('campaigns')
      .select('id, ad_id, advertiser_id, status, monthly_total_cents')
      .in('ad_id', adIds)
    for (const c of (camps ?? []) as {
      id: string
      ad_id: string
      advertiser_id: string
      status: string
      monthly_total_cents: number | null
    }[]) {
      if (c.status === 'active' || c.status === 'paused') paidByAd.set(c.ad_id, true)
      if (!advertiserByAd.has(c.ad_id)) advertiserByAd.set(c.ad_id, c.advertiser_id)
      if (c.status !== 'canceled') adByCampaign.set(c.id, c.ad_id)
      // Prefer the live campaign when an ad has been through more than one.
      const held = campaignByAd.get(c.ad_id)
      if (!held || (held.status !== 'active' && c.status === 'active')) {
        campaignByAd.set(c.ad_id, {
          id: c.id,
          status: c.status,
          monthlyCents: c.monthly_total_cents,
        })
      }
    }
  }

  // Where the ad is asking to run. The advertiser hand-picks venues in the cart
  // (campaign_targets) and the placement engine fills exactly those on approval,
  // so the reviewer has to see them BEFORE approving. A host's own-screen promo
  // carries its venue on the ad itself.
  const venueIdsByAd = new Map<string, string[]>()
  const campaignIds = [...adByCampaign.keys()]
  if (campaignIds.length) {
    const { data: targets } = await supabase
      .from('campaign_targets')
      .select('campaign_id, venue_id')
      .in('campaign_id', campaignIds)
    for (const t of (targets ?? []) as { campaign_id: string; venue_id: string }[]) {
      const adId = adByCampaign.get(t.campaign_id)
      if (!adId) continue
      const list = venueIdsByAd.get(adId) ?? []
      if (!list.includes(t.venue_id)) list.push(t.venue_id)
      venueIdsByAd.set(adId, list)
    }
  }
  for (const ad of ads) {
    if (ad.host_venue_id && !venueIdsByAd.has(ad.id)) venueIdsByAd.set(ad.id, [ad.host_venue_id])
  }

  const wantedVenueIds = [...new Set([...venueIdsByAd.values()].flat())]
  type VenueInfo = { name: string; screens: number; live: boolean }
  const venueById = new Map<string, VenueInfo>()
  if (wantedVenueIds.length) {
    const { data: vs } = await supabase
      .from('venues')
      .select('id, name, status, tvs(id)')
      .in('id', wantedVenueIds)
    for (const v of (vs ?? []) as unknown as {
      id: string
      name: string
      status: string
      tvs: { id: string }[] | null
    }[]) {
      venueById.set(v.id, {
        name: v.name,
        screens: v.tvs?.length ?? 0,
        live: v.status === 'active',
      })
    }
  }

  // Is anyone actually being billed for this, and is that billing healthy? A
  // campaign can read "active" while its Stripe subscription is past_due, so the
  // campaign row alone can't answer "does approving this earn anything".
  const ownerIds = [...new Set(ads.map((a) => a.owner_user_id))]
  type SubInfo = { status: string; periodEnd: string | null }
  const subByCampaign = new Map<string, SubInfo>()
  const subByOwner = new Map<string, SubInfo>()
  // How much of this advertiser we already run. A first-ever submission deserves
  // a closer look than the tenth swap from someone paying every month.
  const liveAdsByOwner = new Map<string, number>()
  if (ownerIds.length) {
    const [{ data: subs }, { data: theirAds }] = await Promise.all([
      supabase
        .from('subscriptions')
        .select('advertiser_id, campaign_id, status, current_period_end')
        .in('advertiser_id', ownerIds),
      supabase
        .from('ads')
        .select('id, owner_user_id, status')
        .in('owner_user_id', ownerIds)
        .in('status', ['approved', 'active', 'paused']),
    ])
    for (const s of (subs ?? []) as {
      advertiser_id: string
      campaign_id: string | null
      status: string
      current_period_end: string | null
    }[]) {
      const info = { status: s.status, periodEnd: s.current_period_end }
      if (s.campaign_id) subByCampaign.set(s.campaign_id, info)
      const held = subByOwner.get(s.advertiser_id)
      if (!held || (held.status !== 'active' && s.status === 'active')) {
        subByOwner.set(s.advertiser_id, info)
      }
    }
    for (const a of (theirAds ?? []) as { id: string; owner_user_id: string }[]) {
      liveAdsByOwner.set(a.owner_user_id, (liveAdsByOwner.get(a.owner_user_id) ?? 0) + 1)
    }
  }

  // One HEAD per creative, in parallel — the queue holds a handful of ads, and
  // an unread size is worth less than a page that renders a second sooner.
  const probes = await Promise.all(
    ads.map(async (ad) => [ad.id, ad.creative_url ? await probeCreative(ad.creative_url) : null] as const)
  )
  const fileByAd = new Map(probes)

  const items: QueueItem[] = ads.map((ad) => ({
    id: ad.id,
    title: ad.title,
    ownerName: ad.owner?.full_name ?? ad.owner?.email ?? 'Unknown',
    ownerId: advertiserByAd.get(ad.id) ?? ad.owner_user_id ?? null,
    ownerKind: ad.owner_kind,
    category: ad.category?.name ?? 'No category',
    territory: ad.territory?.name ?? null,
    createdAt: ad.created_at,
    isPaid: paidByAd.get(ad.id) ?? false,
    creativeUrl: ad.creative_url,
    creativeType: ad.creative_type,
    qrTargetUrl: ad.qr_target_url,
    ownerEmail: ad.owner?.email ?? null,
    ownerPhone: ad.owner?.phone ?? null,
    durationSeconds: ad.duration_seconds,
    fileBytes: fileByAd.get(ad.id)?.bytes ?? null,
    fileType: fileByAd.get(ad.id)?.type ?? null,
    monthlyCents: campaignByAd.get(ad.id)?.monthlyCents ?? null,
    campaignStatus: campaignByAd.get(ad.id)?.status ?? null,
    subStatus:
      (campaignByAd.get(ad.id) && subByCampaign.get(campaignByAd.get(ad.id)!.id)?.status) ??
      subByOwner.get(ad.owner_user_id)?.status ??
      null,
    liveAdCount: liveAdsByOwner.get(ad.owner_user_id) ?? 0,
    venues: (venueIdsByAd.get(ad.id) ?? [])
      .map((id) => venueById.get(id))
      .filter((v): v is VenueInfo => Boolean(v))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }))

  return (
    <>
      <PageHeader
        title="Approval queue"
        description={`${ads.length} ad${ads.length === 1 ? '' : 's'} awaiting review`}
      />
      <SectionTabs tabs={CONTENT_TABS} />
      <div className="p-3 md:p-4">
        <QueueBoard ads={items} nowMs={Date.now()} />
      </div>
    </>
  )
}

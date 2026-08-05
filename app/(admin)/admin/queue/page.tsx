import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, CONTENT_TABS } from '@/components/admin/SectionTabs'
import type { Ad } from '@/lib/db.types'
import { QueueBoard, type QueueItem } from './QueueBoard'

type QueueAd = Ad & {
  owner: { full_name: string | null; email: string } | null
  category: { name: string } | null
  territory: { name: string } | null
}

export default async function QueuePage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  let q = supabase
    .from('ads')
    .select(
      '*, owner:profiles!owner_user_id(full_name, email), category:categories(name), territory:territories(name)'
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
  if (adIds.length) {
    const { data: camps } = await supabase
      .from('campaigns')
      .select('ad_id, advertiser_id, status')
      .in('ad_id', adIds)
    for (const c of (camps ?? []) as { ad_id: string; advertiser_id: string; status: string }[]) {
      if (c.status === 'active' || c.status === 'paused') paidByAd.set(c.ad_id, true)
      if (!advertiserByAd.has(c.ad_id)) advertiserByAd.set(c.ad_id, c.advertiser_id)
    }
  }

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
  }))

  return (
    <>
      <PageHeader
        title="Approval queue"
        description={`${ads.length} ad${ads.length === 1 ? '' : 's'} awaiting review`}
      />
      <SectionTabs tabs={CONTENT_TABS} />
      <div className="p-5 md:p-6">
        <QueueBoard ads={items} nowMs={Date.now()} />
      </div>
    </>
  )
}

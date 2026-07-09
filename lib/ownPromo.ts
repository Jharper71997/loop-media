// Host "own-screen" free promos.
//
// A host can run ONE free promo on their OWN screen(s). Under the hood it's a $0
// campaign whose ad is owner_kind='host' with host_venue_id set to one of the
// host's own venues — which is what distinguishes it from a host's PAID network
// campaigns (owner_kind='advertiser', run on other venues via /host/advertise).
// It flows through the same placement engine as any other campaign, so the TV
// loop plays it with no special-casing.
import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export interface OwnScreenPromo {
  campaignId: string
  adId: string
  venueId: string
  title: string
  status: string
}

// The host's live own-screen promos across the given venues (their own venue ids).
// Runs with the service-role admin client — callers must already be authorized.
export async function getActiveOwnScreenPromos(
  admin: Admin,
  hostUserId: string,
  venueIds: string[]
): Promise<OwnScreenPromo[]> {
  if (!venueIds.length) return []
  const { data } = await admin
    .from('campaigns')
    .select('id, status, ad:ads(id, title, owner_kind, host_venue_id)')
    .eq('advertiser_id', hostUserId)
    .is('deleted_at', null)
  type Row = {
    id: string
    status: string
    ad: { id: string; title: string; owner_kind: string; host_venue_id: string | null } | null
  }
  const rows = (data ?? []) as unknown as Row[]
  return rows
    .filter(
      (c) =>
        c.ad?.owner_kind === 'host' &&
        !!c.ad.host_venue_id &&
        venueIds.includes(c.ad.host_venue_id)
    )
    .map((c) => ({
      campaignId: c.id,
      adId: c.ad!.id,
      venueId: c.ad!.host_venue_id!,
      title: c.ad!.title,
      status: c.status,
    }))
}

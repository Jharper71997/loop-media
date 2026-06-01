import { requireProfile, homeForRole } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Package } from '@/lib/db.types'
import { NewCampaignForm, type BuilderVenue } from './NewCampaignForm'

export default async function NewCampaignPage() {
  const profile = await requireProfile()
  // Admins may build a campaign too (for testing); everyone else goes home.
  if (profile.role !== 'advertiser' && profile.role !== 'admin') {
    redirect(homeForRole(profile.role))
  }
  const supabase = await createClient()

  const [{ data: terr }, { data: pkgs }, { data: cats }, { data: venueRows }] = await Promise.all([
    supabase
      .from('territories')
      .select('id, name')
      .eq('is_holding', false)
      .eq('status', 'active')
      .order('name'),
    supabase.from('packages').select('*').eq('active', true).is('territory_id', null),
    supabase.from('categories').select('id, name').order('name'),
    supabase
      .from('venues')
      .select(
        'id, territory_id, name, category_id, foot_traffic_estimate, tvs(id, loop_length_seconds, slot_seconds)'
      )
      .eq('status', 'active')
      .order('foot_traffic_estimate', { ascending: false }),
  ])

  type VRow = {
    id: string
    territory_id: string
    name: string
    category_id: string | null
    foot_traffic_estimate: number
    tvs: { id: string; loop_length_seconds: number; slot_seconds: number }[]
  }
  const rows = (venueRows ?? []) as unknown as VRow[]

  // Used slots per TV → open inventory per venue.
  const allTvIds = rows.flatMap((r) => r.tvs.map((t) => t.id))
  const usedByTv = new Map<string, number>()
  if (allTvIds.length) {
    const { data: placements } = await supabase
      .from('ad_placements')
      .select('tv_id')
      .in('tv_id', allTvIds)
      .eq('status', 'active')
    for (const p of placements ?? []) usedByTv.set(p.tv_id, (usedByTv.get(p.tv_id) ?? 0) + 1)
  }

  const venues: BuilderVenue[] = rows.map((r) => {
    const capacity = r.tvs.reduce(
      (sum, t) => sum + Math.max(1, Math.floor(t.loop_length_seconds / t.slot_seconds)),
      0
    )
    const used = r.tvs.reduce((sum, t) => sum + (usedByTv.get(t.id) ?? 0), 0)
    return {
      id: r.id,
      territoryId: r.territory_id,
      name: r.name,
      categoryId: r.category_id,
      footTraffic: r.foot_traffic_estimate,
      screens: r.tvs.length,
      capacity,
      open: Math.max(capacity - used, 0),
    }
  })

  return (
    <NewCampaignForm
      userId={profile.id}
      markets={(terr ?? []) as { id: string; name: string }[]}
      packages={(pkgs ?? []) as Package[]}
      categories={(cats ?? []) as { id: string; name: string }[]}
      venues={venues}
    />
  )
}

import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { Territory } from '@/lib/db.types'
import { BrowseClient, type BrowseVenue } from './BrowseClient'

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string; cat?: string }>
}) {
  await requireProfile()
  const supabase = await createClient()

  const [{ data: terr }, { data: catData }] = await Promise.all([
    supabase
      .from('territories')
      .select('*')
      .eq('is_holding', false)
      .eq('status', 'active')
      .order('name'),
    supabase.from('categories').select('id, name').order('name'),
  ])
  const markets = (terr ?? []) as Territory[]
  const categories = (catData ?? []) as { id: string; name: string }[]

  const { market, cat } = await searchParams
  const activeMarket = markets.find((m) => m.id === market)?.id ?? markets[0]?.id ?? null
  const activeCat = categories.find((c) => c.id === cat)?.id ?? null

  let venues: BrowseVenue[] = []
  if (activeMarket) {
    const { data } = await supabase
      .from('venues')
      .select('id, name, venue_type, category_id, lat, lng, foot_traffic_estimate, category:categories(name), tvs(id, loop_length_seconds, slot_seconds)')
      .eq('territory_id', activeMarket)
      .eq('status', 'active')
      .order('foot_traffic_estimate', { ascending: false })

    type Row = {
      id: string
      name: string
      venue_type: string | null
      category_id: string | null
      lat: number | null
      lng: number | null
      foot_traffic_estimate: number
      category: { name: string } | null
      tvs: { id: string; loop_length_seconds: number; slot_seconds: number }[]
    }
    // Exclusivity: when the viewer picks their business category, hide venues of
    // that same category — they could never run there.
    const rows = ((data ?? []) as unknown as Row[]).filter(
      (r) => !(activeCat && r.category_id === activeCat)
    )

    // Active placements per TV → used slots.
    const tvIds = rows.flatMap((r) => r.tvs.map((t) => t.id))
    const usedByTv = new Map<string, number>()
    if (tvIds.length) {
      const { data: placements } = await supabase
        .from('ad_placements')
        .select('tv_id')
        .in('tv_id', tvIds)
        .eq('status', 'active')
      for (const p of placements ?? []) usedByTv.set(p.tv_id, (usedByTv.get(p.tv_id) ?? 0) + 1)
    }

    venues = rows.map((r) => {
      const capacity = r.tvs.reduce(
        (sum, t) => sum + Math.floor(t.loop_length_seconds / t.slot_seconds),
        0
      )
      const used = r.tvs.reduce((sum, t) => sum + (usedByTv.get(t.id) ?? 0), 0)
      return {
        id: r.id,
        name: r.name,
        venue_type: r.venue_type,
        category: r.category?.name ?? null,
        foot_traffic_estimate: r.foot_traffic_estimate,
        lat: r.lat,
        lng: r.lng,
        screens: r.tvs.length,
        capacity,
        open: Math.max(capacity - used, 0),
      }
    })
  }

  return (
    <BrowseClient
      venues={venues}
      markets={markets.map((m) => ({ id: m.id, name: m.name }))}
      activeMarket={activeMarket}
      categories={categories}
      activeCat={activeCat}
    />
  )
}

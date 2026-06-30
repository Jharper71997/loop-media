import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { isTvLive } from '@/lib/format'
import { PageHeader } from '@/components/admin/PageHeader'
import { AdminMap } from './AdminMap'
import type { VenuePin } from './MapCanvas'

export default async function MapPage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  // Active AND pending (inactive) venues — so a newly added location is visible
  // on the map right away (shown as pending until an admin verifies it).
  let venueQ = supabase
    .from('venues')
    .select(
      'id, name, status, lat, lng, foot_traffic_estimate, category:categories(name), tvs(id, status, last_heartbeat_at, loop_length_seconds, slot_seconds)'
    )
    .in('status', ['active', 'inactive'])
  if (t) venueQ = venueQ.eq('territory_id', t)
  const { data: venueData } = await venueQ
  type VRow = {
    id: string
    name: string
    status: string
    lat: number | null
    lng: number | null
    foot_traffic_estimate: number
    category: { name: string } | null
    tvs: {
      id: string
      status: string
      last_heartbeat_at: string | null
      loop_length_seconds: number
      slot_seconds: number
    }[]
  }
  const rows = (venueData ?? []) as unknown as VRow[]

  // tv → venue, capacity per venue.
  const tvToVenue = new Map<string, string>()
  for (const v of rows) for (const tv of v.tvs) tvToVenue.set(tv.id, v.id)
  const allTvIds = [...tvToVenue.keys()]

  // Active placements → used slots per venue + advertiser coverage.
  const usedByVenue = new Map<string, number>()
  const coverage: Record<string, string[]> = {}
  const coverageSets = new Map<string, Set<string>>()
  if (allTvIds.length) {
    const { data: plData } = await supabase
      .from('ad_placements')
      .select('tv_id, campaign:campaigns(advertiser_id)')
      .in('tv_id', allTvIds)
      .eq('status', 'active')
    type PRow = { tv_id: string; campaign: { advertiser_id: string } | null }
    for (const p of (plData ?? []) as unknown as PRow[]) {
      const vid = tvToVenue.get(p.tv_id)
      if (!vid) continue
      usedByVenue.set(vid, (usedByVenue.get(vid) ?? 0) + 1)
      const adv = p.campaign?.advertiser_id
      if (adv) {
        const set = coverageSets.get(adv) ?? new Set<string>()
        set.add(vid)
        coverageSets.set(adv, set)
      }
    }
  }
  for (const [adv, set] of coverageSets) coverage[adv] = [...set]

  // Advertiser names for the coverage selector.
  const advertisers: { id: string; name: string }[] = []
  const advIds = [...coverageSets.keys()]
  if (advIds.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', advIds)
    for (const p of profs ?? []) advertisers.push({ id: p.id, name: p.full_name ?? p.email })
    advertisers.sort((a, b) => a.name.localeCompare(b.name))
  }

  const venues: VenuePin[] = rows.map((v) => {
    const capacity = v.tvs.reduce(
      (sum, tv) => sum + Math.max(1, Math.floor(tv.loop_length_seconds / tv.slot_seconds)),
      0
    )
    return {
      id: v.id,
      name: v.name,
      category: v.category?.name ?? null,
      lat: v.lat,
      lng: v.lng,
      footTraffic: v.foot_traffic_estimate,
      screensTotal: v.tvs.length,
      // tvs.status is only ever written 'online'/'unpaired' (never 'offline'), so
      // a dark screen must be detected from its heartbeat — every other admin
      // surface uses isTvLive. Online = beating recently; offline = paired but
      // gone quiet; unpaired = never set up.
      online: v.tvs.filter((tv) => isTvLive(tv.last_heartbeat_at)).length,
      offline: v.tvs.filter((tv) => tv.status !== 'unpaired' && !isTvLive(tv.last_heartbeat_at))
        .length,
      unpaired: v.tvs.filter((tv) => tv.status === 'unpaired').length,
      capacity,
      used: usedByVenue.get(v.id) ?? 0,
      pending: v.status !== 'active',
    }
  })

  // Category caps panel (only meaningful for a single territory).
  const { data: catData } = await supabase.from('categories').select('id, name').order('name')
  const capByCat = new Map<string, number>()
  if (t) {
    const { data: capData } = await supabase
      .from('category_caps')
      .select('category_id, max_advertisers')
      .eq('territory_id', t)
    for (const c of capData ?? []) capByCat.set(c.category_id, c.max_advertisers)
  }
  const caps = (catData ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    cap: capByCat.get(c.id) ?? null,
  }))

  return (
    <>
      <PageHeader
        title="Map"
        description={
          t ? territory.territories.find((x) => x.id === t)?.name : 'All territories'
        }
      />
      <div className="p-6">
        {venues.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            No active venues to map yet.
          </p>
        ) : (
          <AdminMap
            venues={venues}
            advertisers={advertisers}
            coverage={coverage}
            territoryId={t}
            caps={caps}
          />
        )}
      </div>
    </>
  )
}

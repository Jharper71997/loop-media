import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { Territory, PriceTier } from '@/lib/db.types'
import { suggestTier, tierPriceCents, type QuoteOptions } from '@/lib/pricing'
import { resolveAdvertiserContext, contextToQuoteOptions } from '@/lib/pricing.server'
import { BrowseClient, type BrowseVenue } from './BrowseClient'

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string; cat?: string }>
}) {
  const profile = await requireProfile()
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

  const ctx = await resolveAdvertiserContext(profile.id)
  const quoteOpts: QuoteOptions = contextToQuoteOptions(ctx)

  const { market, cat } = await searchParams
  const activeMarket = markets.find((m) => m.id === market)?.id ?? markets[0]?.id ?? null
  const activeCat = categories.find((c) => c.id === cat)?.id ?? null

  let venues: BrowseVenue[] = []
  if (activeMarket) {
    const { data } = await supabase
      .from('venues')
      .select(
        'id, name, venue_type, category_id, lat, lng, foot_traffic_estimate, price_tier, category_slots, category:categories(name), tvs(id, loop_length_seconds, slot_seconds)'
      )
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
      price_tier: PriceTier | null
      category_slots: number
      category: { name: string } | null
      tvs: { id: string; loop_length_seconds: number; slot_seconds: number }[]
    }
    const rows = (data ?? []) as unknown as Row[]

    // One pass over active placements gives BOTH slot usage per TV and category
    // occupancy per venue (who's already running, by category).
    const tvIds = rows.flatMap((r) => r.tvs.map((t) => t.id))
    const usedByTv = new Map<string, number>()
    const catOccupancy = new Map<string, Map<string, Set<string>>>() // venueId -> cat -> advertisers
    const tvVenue = new Map<string, string>()
    for (const r of rows) for (const t of r.tvs) tvVenue.set(t.id, r.id)

    if (tvIds.length) {
      const { data: placements } = await supabase
        .from('ad_placements')
        .select('tv_id, ad:ads(category_id, owner_user_id)')
        .in('tv_id', tvIds)
        .eq('status', 'active')
      for (const p of (placements ?? []) as unknown as {
        tv_id: string
        ad: { category_id: string | null; owner_user_id: string } | null
      }[]) {
        usedByTv.set(p.tv_id, (usedByTv.get(p.tv_id) ?? 0) + 1)
        const venueId = tvVenue.get(p.tv_id)
        const ad = Array.isArray(p.ad) ? p.ad[0] : p.ad
        if (venueId && ad?.category_id) {
          let byCat = catOccupancy.get(venueId)
          if (!byCat) catOccupancy.set(venueId, (byCat = new Map()))
          let advs = byCat.get(ad.category_id)
          if (!advs) byCat.set(ad.category_id, (advs = new Set()))
          advs.add(ad.owner_user_id)
        }
      }
    }

    // Which venues has this advertiser already waitlisted (for the active cat)?
    const waitlisted = new Set<string>()
    {
      let wq = supabase
        .from('venue_waitlist')
        .select('venue_id, category_id')
        .eq('advertiser_id', profile.id)
      if (activeCat) wq = wq.eq('category_id', activeCat)
      const { data: wl } = await wq
      for (const w of wl ?? []) waitlisted.add(w.venue_id)
    }

    venues = rows.map((r) => {
      const tier: PriceTier = r.price_tier ?? suggestTier(r.foot_traffic_estimate)
      const capacity = r.tvs.reduce(
        (sum, t) => sum + Math.max(1, Math.floor(t.loop_length_seconds / t.slot_seconds)),
        0
      )
      const used = r.tvs.reduce((sum, t) => sum + (usedByTv.get(t.id) ?? 0), 0)
      const open = Math.max(capacity - used, 0)

      // Category exclusivity for the viewer: full when the venue's slots for the
      // viewer's category are taken by other advertisers.
      const catTaken = activeCat ? catOccupancy.get(r.id)?.get(activeCat)?.size ?? 0 : 0
      const categoryFull = !!activeCat && catTaken >= (r.category_slots ?? 1)

      return {
        id: r.id,
        name: r.name,
        venue_type: r.venue_type,
        category: r.category?.name ?? null,
        foot_traffic_estimate: r.foot_traffic_estimate,
        lat: r.lat,
        lng: r.lng,
        tier,
        priceCents: tierPriceCents(tier),
        screens: r.tvs.length,
        capacity,
        open,
        categoryFull,
        waitlisted: waitlisted.has(r.id),
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
      quoteOpts={quoteOpts}
    />
  )
}

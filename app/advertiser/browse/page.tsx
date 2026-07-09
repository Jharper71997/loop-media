import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { Territory, PriceTier } from '@/lib/db.types'
import { suggestTier, venuePriceCents, type QuoteOptions } from '@/lib/pricing'
import {
  resolveAdvertiserContext,
  contextToQuoteOptions,
  getPricingConfig,
} from '@/lib/pricing.server'
import { isVenueListable } from '@/lib/venue'
import { isTvLive } from '@/lib/format'
import { BrowseClient, type BrowseVenue } from './BrowseClient'

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; pick?: string }>
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
  const marketIds = markets.map((m) => m.id)
  const categories = (catData ?? []) as { id: string; name: string }[]

  const ctx = await resolveAdvertiserContext(profile.id)
  const pricingConfig = await getPricingConfig()
  const quoteOpts: QuoteOptions = contextToQuoteOptions(ctx)

  const { cat: catParam, pick } = await searchParams
  // Fall back to the category saved on this advertiser's profile last time, so a
  // returning advertiser lands straight on the map with their line of business
  // already locked in — no re-picking. An explicit ?cat= (incl. 'all') still wins.
  // ?pick=1 forces the category picker (the "change category" affordance) and must
  // override the saved-profile fallback, or "change" would just reopen the same one.
  const cat = pick ? undefined : catParam ?? profile.category_id ?? undefined
  const activeCat = categories.find((c) => c.id === cat)?.id ?? null
  // Step 1 of the flow: the category must be chosen (a real id, or 'all' to skip)
  // before we show the map. Absent param = not chosen yet. There is no separate
  // "pick a county/city" step: once they say what they sell, the map shows every
  // venue across all live markets and they tap wherever they want a screen.
  const categoryChosen = cat != null

  let venues: BrowseVenue[] = []
  if (marketIds.length && categoryChosen) {
    const { data } = await supabase
      .from('venues')
      .select(
        'id, name, logo_url, venue_type, category_id, host_user_id, lat, lng, foot_traffic_estimate, price_tier, price_cents_override, category:categories(name), tvs(id, last_heartbeat_at, loop_length_seconds, slot_seconds)'
      )
      .in('territory_id', marketIds)
      .eq('status', 'active')
      // Demo venues never show on the real buy map.
      .eq('is_demo', false)
      .order('foot_traffic_estimate', { ascending: false })

    type Row = {
      id: string
      name: string
      logo_url: string | null
      venue_type: string | null
      category_id: string | null
      host_user_id: string | null
      lat: number | null
      lng: number | null
      foot_traffic_estimate: number
      price_tier: PriceTier | null
      price_cents_override: number | null
      category: { name: string } | null
      tvs: { id: string; last_heartbeat_at: string | null; loop_length_seconds: number; slot_seconds: number }[]
    }
    const rows = (data ?? []) as unknown as Row[]

    // One pass over active placements gives slot usage per TV (for open-slot counts).
    const tvIds = rows.flatMap((r) => r.tvs.map((t) => t.id))
    const usedByTv = new Map<string, number>()
    if (tvIds.length) {
      const { data: placements } = await supabase
        .from('ad_placements')
        .select('tv_id')
        .in('tv_id', tvIds)
        .eq('status', 'active')
      for (const p of placements ?? []) {
        usedByTv.set(p.tv_id, (usedByTv.get(p.tv_id) ?? 0) + 1)
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
      // Coming soon = no screen has checked in recently (the Pi isn't online yet).
      // Flips to live automatically once any TV at the venue heartbeats (<95s).
      const comingSoon = !r.tvs.some((t) => isTvLive(t.last_heartbeat_at))

      // Host protection: a venue never runs a COMPETITOR's ad in its own line of
      // business (a barbershop blocks other barbers). But the venue's OWN owner may
      // promote themselves on their own screen. This is the ONLY exclusivity —
      // unrelated advertisers freely share a screen.
      const ownCategory =
        !!activeCat && activeCat === r.category_id && r.host_user_id !== profile.id
      // Only own-business screens are blocked (kept as `categoryFull` for the
      // card/map, which gray out and disable adding when it's true).
      const categoryFull = ownCategory

      return {
        id: r.id,
        name: r.name,
        logoUrl: r.logo_url,
        venue_type: r.venue_type,
        category: r.category?.name ?? null,
        foot_traffic_estimate: r.foot_traffic_estimate,
        lat: r.lat,
        lng: r.lng,
        tier,
        priceCents: venuePriceCents(r.price_cents_override, tier, pricingConfig),
        screens: r.tvs.length,
        capacity,
        open,
        comingSoon,
        categoryFull,
        ownCategory,
        waitlisted: waitlisted.has(r.id),
      }
    })

    // Only surface venues with real data (known traffic + a map location).
    // Incomplete venues stay hidden from advertisers — no made-up numbers.
    // Only real, registered screens matter to an advertiser — hide venues that
    // don't have a screen set up yet.
    venues = venues.filter((v) => isVenueListable(v) && v.screens > 0)
  }

  return (
    <BrowseClient
      venues={venues}
      categories={categories}
      activeCat={activeCat}
      categoryChosen={categoryChosen}
      quoteOpts={quoteOpts}
      pricingConfig={pricingConfig}
    />
  )
}

// Sellable inventory — what is actually available to sell, per venue.
//
// The admin could always tell you what had been sold. It could not tell you what
// was LEFT, which is the only view that matters when the network is ~6% sold and
// the job for the next quarter is filling it. This turns venues + screens +
// active placements into a call list: every location, how many spots are open on
// it, what one costs, and who already owns the category there.
//
// Slot math is deliberately delegated to lib/loop.ts so this agrees with the
// screen page, the advertiser's browse map and the placement engine. House
// slides are NOT counted here — they never consume a sellable spot.
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { isTvLive } from '@/lib/format'
import { adSlotCount } from '@/lib/loop'
import { suggestTier, venuePriceCents, TIER_LABEL } from '@/lib/pricing'
import { getPricingConfig } from '@/lib/pricing.server'
import type { PriceTier } from '@/lib/db.types'

export interface ScreenInventory {
  id: string
  live: boolean
  paired: boolean
  slots: number
  sold: number
  open: number
}

export interface VenueInventory {
  venueId: string
  name: string
  active: boolean
  /** The venue's OWN line of business — competitors can never be sold in here. */
  ownCategory: string | null
  city: string | null
  hostName: string | null
  contact: { name: string | null; email: string | null; phone: string | null }
  tierLabel: string
  priceCents: number
  footTraffic: number
  screens: ScreenInventory[]
  totalSlots: number
  sold: number
  open: number
  liveScreens: number
  /** Advertisers already running here, so you don't pitch a category that's taken. */
  runningTitles: string[]
  /** Monthly value of this venue's unsold spots at its current rate. */
  openValueCents: number
}

export interface InventoryTotals {
  venues: number
  screens: number
  liveScreens: number
  slots: number
  sold: number
  open: number
  pctSold: number
  openValueCents: number
  soldValueCents: number
}

export interface Inventory {
  rows: VenueInventory[]
  totals: InventoryTotals
}

export const loadInventory = cache(async (territoryId: string | null): Promise<Inventory> => {
  const supabase = await createClient()
  const config = await getPricingConfig()

  let vq = supabase
    .from('venues')
    .select(
      'id, name, status, city, foot_traffic_estimate, price_tier, price_cents_override, contact_name, contact_email, contact_phone, host_user_id, category:categories(name)'
    )
    .eq('is_demo', false)
    .order('name')
  if (territoryId) vq = vq.eq('territory_id', territoryId)
  const { data: venueData } = await vq

  type VRow = {
    id: string
    name: string
    status: string
    city: string | null
    foot_traffic_estimate: number
    price_tier: PriceTier | null
    price_cents_override: number | null
    contact_name: string | null
    contact_email: string | null
    contact_phone: string | null
    host_user_id: string | null
    category: { name: string } | { name: string }[] | null
  }
  const venues = (venueData ?? []) as unknown as VRow[]
  if (!venues.length) {
    return {
      rows: [],
      totals: {
        venues: 0,
        screens: 0,
        liveScreens: 0,
        slots: 0,
        sold: 0,
        open: 0,
        pctSold: 0,
        openValueCents: 0,
        soldValueCents: 0,
      },
    }
  }

  const venueIds = venues.map((v) => v.id)
  const { data: tvData } = await supabase
    .from('tvs')
    .select('id, venue_id, device_id, last_heartbeat_at, loop_length_seconds, slot_seconds')
    .in('venue_id', venueIds)
  type TRow = {
    id: string
    venue_id: string
    device_id: string | null
    last_heartbeat_at: string | null
    loop_length_seconds: number
    slot_seconds: number
  }
  const tvs = (tvData ?? []) as TRow[]

  // Active placements per screen = spots already sold there.
  const soldByTv = new Map<string, number>()
  const titlesByTv = new Map<string, string[]>()
  if (tvs.length) {
    const { data: plData } = await supabase
      .from('ad_placements')
      .select('tv_id, ad:ads(title)')
      .eq('status', 'active')
      .in(
        'tv_id',
        tvs.map((t) => t.id)
      )
    for (const p of (plData ?? []) as { tv_id: string; ad: { title: string } | { title: string }[] | null }[]) {
      soldByTv.set(p.tv_id, (soldByTv.get(p.tv_id) ?? 0) + 1)
      const ad = Array.isArray(p.ad) ? p.ad[0] : p.ad
      if (ad?.title) titlesByTv.set(p.tv_id, [...(titlesByTv.get(p.tv_id) ?? []), ad.title])
    }
  }

  // Host names, for "who do I call about this location".
  const hostIds = [...new Set(venues.map((v) => v.host_user_id).filter((x): x is string => !!x))]
  const hostById = new Map<string, string>()
  if (hostIds.length) {
    const { data: hosts } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', hostIds)
    for (const h of (hosts ?? []) as { id: string; full_name: string | null; email: string }[]) {
      hostById.set(h.id, h.full_name ?? h.email)
    }
  }

  const rows: VenueInventory[] = venues.map((v) => {
    const tier = v.price_tier ?? suggestTier(v.foot_traffic_estimate)
    const priceCents = venuePriceCents(v.price_cents_override, tier, config)
    const mine = tvs.filter((t) => t.venue_id === v.id)

    const screens: ScreenInventory[] = mine.map((t) => {
      const slots = adSlotCount(t.loop_length_seconds, t.slot_seconds)
      const sold = Math.min(soldByTv.get(t.id) ?? 0, slots)
      return {
        id: t.id,
        paired: !!t.device_id,
        live: !!t.device_id && isTvLive(t.last_heartbeat_at),
        slots,
        sold,
        open: Math.max(0, slots - sold),
      }
    })

    const totalSlots = screens.reduce((a, s) => a + s.slots, 0)
    const sold = screens.reduce((a, s) => a + s.sold, 0)
    const open = screens.reduce((a, s) => a + s.open, 0)
    const runningTitles = [...new Set(mine.flatMap((t) => titlesByTv.get(t.id) ?? []))]

    return {
      venueId: v.id,
      name: v.name,
      active: v.status === 'active',
      ownCategory: (Array.isArray(v.category) ? v.category[0] : v.category)?.name ?? null,
      city: v.city,
      hostName: v.host_user_id ? (hostById.get(v.host_user_id) ?? null) : null,
      contact: { name: v.contact_name, email: v.contact_email, phone: v.contact_phone },
      tierLabel: v.price_cents_override != null ? 'Custom' : TIER_LABEL[tier],
      priceCents,
      footTraffic: v.foot_traffic_estimate,
      screens,
      totalSlots,
      sold,
      open,
      liveScreens: screens.filter((s) => s.live).length,
      runningTitles,
      // A location is sold per-advertiser at its monthly rate, so each open spot
      // is worth one more sale at that rate.
      openValueCents: open * priceCents,
    }
  })

  // Only ACTIVE venues count toward what's sellable — a hidden venue is not
  // inventory, and counting it makes the network look emptier than it is.
  const sellable = rows.filter((r) => r.active)
  const slots = sellable.reduce((a, r) => a + r.totalSlots, 0)
  const sold = sellable.reduce((a, r) => a + r.sold, 0)

  return {
    rows,
    totals: {
      venues: sellable.length,
      screens: sellable.reduce((a, r) => a + r.screens.length, 0),
      liveScreens: sellable.reduce((a, r) => a + r.liveScreens, 0),
      slots,
      sold,
      open: sellable.reduce((a, r) => a + r.open, 0),
      pctSold: slots > 0 ? Math.round((sold / slots) * 100) : 0,
      openValueCents: sellable.reduce((a, r) => a + r.openValueCents, 0),
      soldValueCents: sellable.reduce((a, r) => a + r.sold * r.priceCents, 0),
    },
  }
})

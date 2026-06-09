// Loop Media — pricing engine (the spine).
//
// Per-TV à la carte: every venue has a price TIER; the advertiser taps venues
// into a cart and the monthly bill is the sum of the picked venues' tier prices,
// less a volume discount (more screens → lower rate), less host / loyalty
// discounts, floored at the $200/mo account minimum. Free-screen credits earned
// from loyalty milestones comp the advertiser's cheapest screens.
//
// Everything in this file is PURE and client-safe (no server imports) so the
// cart UI and the checkout action compute identical numbers. The DB resolver at
// the bottom is the only server-touching helper.

export type PriceTier = 'local' | 'standard' | 'high' | 'premium'

// Stephen's anchors: gym = $75 (High). The rest set around it.
export const TIER_PRICE_CENTS: Record<PriceTier, number> = {
  premium: 9500, // 1,500+ people/day
  high: 7500, //    800–1,500  ← gym anchor
  standard: 5500, // 400–800
  local: 4000, //   under 400
}

export const TIER_LABEL: Record<PriceTier, string> = {
  premium: 'Premium',
  high: 'High traffic',
  standard: 'Standard',
  local: 'Local',
}

// Account floor: $200/mo to open an account (~3 Standard screens).
export const MIN_MONTHLY_CENTS = 20000

// Hosts advertising elsewhere in the network get 20% off the per-TV rate.
export const HOST_DISCOUNT = 0.2

// 12-months-active loyalty perk: an extra 5% off everything.
export const LOYALTY_12MO_DISCOUNT = 0.05

// Stacked-discount safety cap so margin never collapses when host + max volume +
// loyalty all land on one account. Named knob — raise/lower with Stephen.
export const MAX_DISCOUNT = 0.35

export function tierPriceCents(tier: PriceTier): number {
  return TIER_PRICE_CENTS[tier]
}

// Starting tier suggestion from a foot-traffic estimate (~monthly visitors).
// The venue's explicit price_tier is the real source of truth; this only seeds
// the admin dialog.
export function suggestTier(footTrafficMonthly: number): PriceTier {
  if (footTrafficMonthly >= 40000) return 'premium'
  if (footTrafficMonthly >= 20000) return 'high'
  if (footTrafficMonthly >= 10000) return 'standard'
  return 'local'
}

// Volume discount by number of screens actively running (the "lower and lower"
// curve). Capped at 25% so a brand-new tap still pays full price.
export function volumeDiscount(screens: number): number {
  if (screens >= 25) return 0.25
  if (screens >= 15) return 0.2
  if (screens >= 10) return 0.15
  if (screens >= 5) return 0.1
  return 0
}

export interface QuoteOptions {
  isHost?: boolean // host advertising elsewhere → 20% off
  loyalty12mo?: boolean // 12 months active → extra 5%
  freeScreens?: number // milestone credits (e.g. hit 10 TVs → 2 free)
}

export interface Quote {
  screens: number // billable screens (after free credits)
  totalScreens: number // screens in the cart
  freeScreens: number // comped this quote
  listCents: number // sum of every screen's tier price (no discounts)
  subtotalCents: number // list minus comped screens
  volumePct: number
  hostPct: number
  loyaltyPct: number
  discountPct: number // combined, capped at MAX_DISCOUNT
  discountedCents: number // subtotal after discount
  floorApplied: boolean
  totalCents: number // what they pay (>= MIN_MONTHLY_CENTS once non-empty)
}

// Quote a cart of venue tiers. `tiers` is one entry per screen in the cart.
export function quoteCart(tiers: PriceTier[], opts: QuoteOptions = {}): Quote {
  const totalScreens = tiers.length
  const listCents = tiers.reduce((s, t) => s + TIER_PRICE_CENTS[t], 0)

  // Comp the cheapest screens first (best advertiser experience).
  const sorted = [...tiers].sort((a, b) => TIER_PRICE_CENTS[a] - TIER_PRICE_CENTS[b])
  const freeScreens = Math.min(Math.max(opts.freeScreens ?? 0, 0), totalScreens)
  const compedCents = sorted.slice(0, freeScreens).reduce((s, t) => s + TIER_PRICE_CENTS[t], 0)
  const subtotalCents = listCents - compedCents
  const billableScreens = totalScreens - freeScreens

  const volumePct = volumeDiscount(totalScreens)
  const hostPct = opts.isHost ? HOST_DISCOUNT : 0
  const loyaltyPct = opts.loyalty12mo ? LOYALTY_12MO_DISCOUNT : 0
  const discountPct = Math.min(volumePct + hostPct + loyaltyPct, MAX_DISCOUNT)

  const discountedCents = Math.round(subtotalCents * (1 - discountPct))

  // Floor only applies to a non-empty cart.
  const floorApplied = totalScreens > 0 && discountedCents < MIN_MONTHLY_CENTS
  const totalCents = totalScreens === 0 ? 0 : Math.max(discountedCents, MIN_MONTHLY_CENTS)

  return {
    screens: billableScreens,
    totalScreens,
    freeScreens,
    listCents,
    subtotalCents,
    volumePct,
    hostPct,
    loyaltyPct,
    discountPct,
    discountedCents,
    floorApplied,
    totalCents,
  }
}

// Loyalty milestones → free-screen credits + flags. Pure so the dashboard and
// the cart agree. `monthsActive` and `screensRunning` come from the advertiser's
// subscription history.
export interface LoyaltyState {
  monthsActive: number
  screensRunning: number
}
export function loyaltyCredits(s: LoyaltyState): {
  freeScreens: number
  rateLocked: boolean
  loyalty12mo: boolean
} {
  let freeScreens = 0
  if (s.screensRunning >= 10) freeScreens += 2 // hit 10 TVs → 2 free
  if (s.monthsActive >= 6) freeScreens += 1 //   6 months → 1 bonus free
  return {
    freeScreens,
    rateLocked: s.monthsActive >= 3, // 3 months → rates lock ("Founding Advertiser")
    loyalty12mo: s.monthsActive >= 12, // 12 months → extra 5% off
  }
}

// NOTE: the server-only re-pricing resolver (resolveCartCents) lives in
// lib/pricing.server.ts so this file stays client-safe (no next/headers).

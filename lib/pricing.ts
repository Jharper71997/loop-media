// Loop Network — pricing engine (the spine).
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

// All editable pricing knobs in one object. The DB row (pricing_config) overrides
// these per deployment via getPricingConfig(); this is the fallback when the DB is
// unreachable, and the seed values for migration 0023.
export interface PricingConfig {
  tierPriceCents: Record<PriceTier, number>
  minMonthlyCents: number
  hostDiscount: number // host advertising elsewhere -> fraction off (0.2 = 20%)
  loyalty12moDiscount: number // 12 months active -> extra fraction off
  maxDiscount: number // safety cap on combined discounts
  exclusivityPriceCents: number // default monthly upcharge to own a category at a venue
}

// Fallback pricing used ONLY when the pricing_config DB row can't be read. Keep
// this in sync with the live pricing_config row (currently a $50 screen floor /
// $200 minimum) so a missing or unreadable row can't silently bill a different
// rate. Admins tune the live values at /admin/pricing.
export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  tierPriceCents: {
    premium: 12000,
    high: 9500,
    standard: 8500,
    local: 5000,
  },
  minMonthlyCents: 20000, // $200/mo account minimum
  hostDiscount: 0.2,
  loyalty12moDiscount: 0.05,
  maxDiscount: 0.35,
  exclusivityPriceCents: 15000, // $150/mo to own a category at a venue (admin-tunable)
}

export const TIER_LABEL: Record<PriceTier, string> = {
  premium: 'Premium',
  high: 'High traffic',
  standard: 'Standard',
  local: 'Local',
}

// Back-compat re-exports: some call sites import these directly. They mirror
// DEFAULT_PRICING_CONFIG; price-accurate code should take a PricingConfig instead.
export const TIER_PRICE_CENTS = DEFAULT_PRICING_CONFIG.tierPriceCents
export const MIN_MONTHLY_CENTS = DEFAULT_PRICING_CONFIG.minMonthlyCents
export const HOST_DISCOUNT = DEFAULT_PRICING_CONFIG.hostDiscount
export const LOYALTY_12MO_DISCOUNT = DEFAULT_PRICING_CONFIG.loyalty12moDiscount
export const MAX_DISCOUNT = DEFAULT_PRICING_CONFIG.maxDiscount

export function tierPriceCents(
  tier: PriceTier,
  config: PricingConfig = DEFAULT_PRICING_CONFIG
): number {
  return config.tierPriceCents[tier]
}

// A venue's effective monthly per-screen price. An explicit override (cents) wins;
// otherwise it's the tier price from config. One place so admin display, the cart
// preview, and billing all resolve the same number.
export function venuePriceCents(
  priceCentsOverride: number | null | undefined,
  tier: PriceTier,
  config: PricingConfig = DEFAULT_PRICING_CONFIG
): number {
  return priceCentsOverride ?? config.tierPriceCents[tier]
}

// A venue's effective monthly exclusivity upcharge. A per-venue override (cents)
// wins; otherwise the network default from config. One place so the cart preview,
// the review toggle, and billing all resolve the same number.
export function venueExclusivityCents(
  exclusivityOverride: number | null | undefined,
  config: PricingConfig = DEFAULT_PRICING_CONFIG
): number {
  return exclusivityOverride ?? config.exclusivityPriceCents
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

// Quote a cart of screens. `screenCents` is one entry per screen — the venue's
// effective monthly price (custom override or tier price), already resolved by
// the caller (see venuePriceCents). Cent-based so a per-venue override that isn't
// one of the four tier prices bills correctly.
export function quoteCart(
  screenCents: number[],
  opts: QuoteOptions = {},
  config: PricingConfig = DEFAULT_PRICING_CONFIG
): Quote {
  const totalScreens = screenCents.length
  const listCents = screenCents.reduce((s, c) => s + c, 0)

  // Comp the cheapest screens first (best advertiser experience).
  const sorted = [...screenCents].sort((a, b) => a - b)
  const freeScreens = Math.min(Math.max(opts.freeScreens ?? 0, 0), totalScreens)
  const compedCents = sorted.slice(0, freeScreens).reduce((s, c) => s + c, 0)
  const subtotalCents = listCents - compedCents
  const billableScreens = totalScreens - freeScreens

  const volumePct = volumeDiscount(totalScreens)
  const hostPct = opts.isHost ? config.hostDiscount : 0
  const loyaltyPct = opts.loyalty12mo ? config.loyalty12moDiscount : 0
  const discountPct = Math.min(volumePct + hostPct + loyaltyPct, config.maxDiscount)

  const discountedCents = Math.round(subtotalCents * (1 - discountPct))

  // Floor only applies to a non-empty cart.
  const floorApplied = totalScreens > 0 && discountedCents < config.minMonthlyCents
  const totalCents = totalScreens === 0 ? 0 : Math.max(discountedCents, config.minMonthlyCents)

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

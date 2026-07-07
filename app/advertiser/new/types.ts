import type { PriceTier } from '@/lib/pricing'

// sessionStorage key holding the venue ids the buyer chose to own their category
// at (exclusivity). Set in ReviewStep, read + cleared in CreativeStep — mirrors
// CART_KEY so the multi-step /new flow carries the choice without prop threading.
export const EXCL_KEY = 'lm_excl_v1'

export type CartVenue = {
  id: string
  territoryId: string
  name: string
  categoryId: string | null
  footTraffic: number
  tier: PriceTier
  priceCents: number
  // Monthly upcharge to own this venue's category (shown on the exclusivity toggle).
  exclusivityCents: number
  // Whether exclusivity is buyable here right now (no competitor active, not taken).
  exclusivityAvailable: boolean
}

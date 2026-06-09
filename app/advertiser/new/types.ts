import type { PriceTier } from '@/lib/pricing'

export type CartVenue = {
  id: string
  territoryId: string
  name: string
  categoryId: string | null
  footTraffic: number
  tier: PriceTier
  priceCents: number
}

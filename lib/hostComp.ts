// Host advertising comp code.
//
// A host's perk (replacing the old "2 free promo slots") is a 100%-off Stripe
// promotion code, readable from their business name, minted when their venue goes
// live. They enter it at advertiser checkout — Stripe Checkout already sets
// allow_promotion_codes, so no checkout change is needed.
//
// Abuse note: the code is readable (a business name) and not customer-locked, so
// treat it as a shareable comp. If that ever matters, add max_redemptions or lock
// it to the host's Stripe customer here.

import { stripe } from '@/lib/stripe'

// One reusable coupon backs every host comp code: 100% off, forever. Created
// lazily with a stable id so we never make duplicates.
const HOST_COMP_COUPON_ID = 'host-comp-100'

async function ensureHostCompCoupon(): Promise<void> {
  const s = stripe()
  try {
    await s.coupons.retrieve(HOST_COMP_COUPON_ID)
  } catch {
    await s.coupons.create({
      id: HOST_COMP_COUPON_ID,
      percent_off: 100,
      duration: 'forever',
      name: 'Host advertising comp — 100% off',
    })
  }
}

// Business name -> a readable, Stripe-safe code base: uppercase alphanumerics
// only, capped. "Dragon Brew" -> "DRAGONBREW".
function codeBaseFromName(name: string): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
  return base || 'HOST'
}

function randSuffix(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase()
}

// Create a 100%-off-forever promotion code for a host, readable from their
// business name. Returns the code string. Retries with a suffix on collision
// (Stripe requires codes to be unique across the account).
export async function createHostCompCode(businessName: string): Promise<string> {
  const s = stripe()
  await ensureHostCompCoupon()
  const base = codeBaseFromName(businessName)
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = attempt === 0 ? base : `${base}${randSuffix()}`
    try {
      const promo = await s.promotionCodes.create({
        promotion: { type: 'coupon', coupon: HOST_COMP_COUPON_ID },
        code,
      })
      return promo.code
    } catch (e) {
      // A duplicate/invalid code throws; try the next suffix. Re-throw anything
      // that isn't a code collision.
      const msg = e instanceof Error ? e.message.toLowerCase() : ''
      if (!/code|already|exist|use/.test(msg)) throw e
    }
  }
  throw new Error('Could not generate a unique comp code.')
}

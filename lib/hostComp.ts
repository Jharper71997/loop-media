// Host advertising comp code.
//
// A host's perk (replacing the old "2 free promo slots") is a 100%-off Stripe
// promotion code, readable from their business name, minted when their venue goes
// live. The buy flow applies it for them: submitCampaign resolves the stored code
// to its promotion id and attaches it to the Checkout session, so a host never has
// to remember or retype it. The code is still shown on their dashboard.
//
// The code is capped at 2 redemptions (the host's "2 free TVs"). It is readable
// (a business name) and not customer-locked; if sharing ever matters, lock it to
// the host's Stripe customer here.

import { stripe } from '@/lib/stripe'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// How many screens the perk covers. Stripe can only cap REDEMPTIONS, and the
// coupon is 100% off the whole order — so a single checkout with five screens in
// the cart would comp all five and still leave a redemption on the code. The buy
// flow enforces the screen count itself against this number.
export const HOST_COMP_MAX_SCREENS = 2

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
        // Cap the host's free advertising: the code can be redeemed at most twice
        // (their "2 free TVs"). NOTE: this caps checkout USES, not screens per
        // checkout — a single order with 3 screens is one redemption.
        max_redemptions: 2,
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

// Resolve a stored comp code to the live Stripe promotion code id, or null when
// there's nothing usable. Checkout's `discounts` takes the id (promo_...), not the
// code string, so this is the lookup that lets us apply it automatically.
//
// Null on anything doubtful (missing, deactivated, redemptions used up, Stripe
// unreachable) — the caller then falls back to the manual promo-code box rather
// than sending a dead discount into Checkout, which would fail the whole session.
export async function hostCompPromotionId(code: string | null): Promise<string | null> {
  if (!code?.trim()) return null
  try {
    const { data } = await stripe().promotionCodes.list({
      code: code.trim(),
      active: true,
      limit: 1,
    })
    const promo = data[0]
    if (!promo) return null
    // Stripe deactivates a code once max_redemptions is hit, but check anyway so a
    // code exhausted mid-flight can't take the checkout down with it.
    if (promo.max_redemptions != null && promo.times_redeemed >= promo.max_redemptions) return null
    if (promo.expires_at != null && promo.expires_at * 1000 <= Date.now()) return null
    return promo.id
  } catch {
    return null
  }
}

// The comp code a buyer is entitled to as a host: the first active venue of theirs
// that has one. Hosts with several live venues still get one perk, not one each.
export async function hostCompCodeForUser(admin: Admin, userId: string): Promise<string | null> {
  try {
    const { data } = await admin
      .from('venues')
      .select('comp_promo_code')
      .eq('host_user_id', userId)
      .eq('status', 'active')
      .not('comp_promo_code', 'is', null)
      .limit(1)
      .maybeSingle()
    return (data as { comp_promo_code: string | null } | null)?.comp_promo_code ?? null
  } catch {
    return null
  }
}

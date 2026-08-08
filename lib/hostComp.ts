// Host advertising comp code.
//
// A host's perk (replacing the old "2 free promo slots") is a 100%-off Stripe
// promotion code, readable from their business name, minted when their venue goes
// live. The buy flow applies it for them: submitCampaign resolves the stored code
// to its promotion id and attaches it to the Checkout session, so a host never has
// to remember or retype it. The code is still shown on their dashboard.
//
// The SCREEN limit is enforced here in the app (hostFreeScreenUsage), not by the
// code's redemption cap — one redemption is one checkout however many screens
// were in it, so Stripe cannot count this for us.
//
// KNOWN GAP: the code is readable (a business name) and not customer-locked, so
// anyone who learns one can type it into the manual promo box for 100% off their
// own order. The redemption cap is all that bounds that today. Locking each code
// to the host's Stripe customer is the fix; it needs a customer to exist at mint
// time, which it does not yet.

import { stripe } from '@/lib/stripe'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// The perk scales with what the host actually gives us: two free advertising
// screens for every screen they put in their establishment. A host with one TV
// gets two; a host with three TVs gets six. It is priced that way on purpose —
// a host who takes a second screen is doubling our inventory in their room, and
// the thing they get back should double with it.
//
// Stripe can only cap REDEMPTIONS, and the coupon is 100% off the whole order,
// so the redemption cap cannot enforce a screen count: a single checkout with
// five screens in the cart is one redemption. The buy flow enforces the screen
// count itself against hostFreeScreenAllowance().
export const FREE_SCREENS_PER_HOSTED_TV = 2

/**
 * How many free advertising screens this host has earned: two per screen they
 * host at a live venue. Returns 0 for someone who hosts nothing, which is also
 * the safe answer when the lookup fails — a wrong 0 means they use the manual
 * promo box, a wrong number means we comp screens nobody agreed to.
 */
export async function hostFreeScreenAllowance(admin: Admin, userId: string): Promise<number> {
  try {
    const { data } = await admin
      .from('venues')
      .select('id, tvs(id)')
      .eq('host_user_id', userId)
      .eq('status', 'active')
    const hostedTvs = ((data ?? []) as unknown as { tvs: { id: string }[] | null }[]).reduce(
      (n, v) => n + (v.tvs?.length ?? 0),
      0
    )
    return hostedTvs * FREE_SCREENS_PER_HOSTED_TV
  } catch {
    return 0
  }
}

/**
 * The allowance, what they have already taken, and what is left.
 *
 * `remaining` is the number that has to gate a checkout. Gating on the full
 * allowance instead — which is what the old flat cap did — bounds the size of
 * ONE order and nothing else, so a host entitled to four screens could place
 * four separate four-screen orders and take sixteen. The only thing standing in
 * the way was the Stripe redemption cap, which counts checkouts rather than
 * screens and therefore cannot enforce this either.
 */
export async function hostFreeScreenUsage(
  admin: Admin,
  userId: string
): Promise<{ allowance: number; using: number; remaining: number }> {
  const allowance = await hostFreeScreenAllowance(admin, userId)
  if (allowance <= 0) return { allowance: 0, using: 0, remaining: 0 }
  try {
    const { data: camps } = await admin
      .from('campaigns')
      .select('id, comp_until, monthly_total_cents, is_demo')
      .eq('advertiser_id', userId)
      .in('status', ['active', 'paused'])
    // Free = comped, or priced at nothing. Both are ways a campaign costs them
    // zero, and the deal is written in screens, so screens is what we count.
    const freeIds = ((camps ?? []) as {
      id: string
      comp_until: string | null
      monthly_total_cents: number | null
      is_demo: boolean
    }[])
      .filter((c) => !c.is_demo && (!!c.comp_until || (c.monthly_total_cents ?? 0) === 0))
      .map((c) => c.id)

    let using = 0
    if (freeIds.length) {
      const { count } = await admin
        .from('ad_placements')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')
        .in('campaign_id', freeIds)
      using = count ?? 0
    }
    return { allowance, using, remaining: Math.max(0, allowance - using) }
  } catch {
    // Fail closed: an unknown usage must not hand out free screens.
    return { allowance, using: allowance, remaining: 0 }
  }
}

type PromoInfo = { id: string; code: string; maxRedemptions: number | null; timesRedeemed: number }

async function findPromo(code: string): Promise<PromoInfo | null> {
  try {
    const { data } = await stripe().promotionCodes.list({ code: code.trim(), limit: 1 })
    const p = data[0]
    if (!p) return null
    return {
      id: p.id,
      code: p.code,
      maxRedemptions: p.max_redemptions ?? null,
      timesRedeemed: p.times_redeemed ?? 0,
    }
  } catch {
    return null
  }
}

/**
 * The host's comp code, guaranteed to be able to carry their current allowance.
 *
 * Stripe does not let you change `max_redemptions` on an existing promotion
 * code — it is fixed at creation — so a code minted when a host had one screen
 * is stuck at two redemptions forever, even after they add a second TV and earn
 * four. The only way to raise it is to mint a replacement and retire the old
 * one, which is what this does, lazily, the first time it matters.
 *
 * Redemptions are a backstop, not the enforcement: a redemption is one checkout
 * regardless of how many screens were in it. hostFreeScreenUsage() is what
 * actually limits the screens.
 */
export async function ensureHostCompCode(admin: Admin, userId: string): Promise<string | null> {
  try {
    const { data } = await admin
      .from('venues')
      .select('id, name, comp_promo_code')
      .eq('host_user_id', userId)
      .eq('status', 'active')
    const venues = (data ?? []) as { id: string; name: string; comp_promo_code: string | null }[]
    if (!venues.length) return null

    const allowance = await hostFreeScreenAllowance(admin, userId)
    if (allowance <= 0) return null

    const current = venues.find((v) => v.comp_promo_code)?.comp_promo_code ?? null
    if (current) {
      const promo = await findPromo(current)
      // Usable, and roomy enough that taking the allowance one screen at a time
      // cannot run it out. Leave it alone.
      if (
        promo &&
        (promo.maxRedemptions == null || promo.maxRedemptions - promo.timesRedeemed >= allowance)
      ) {
        return promo.code
      }
      if (promo) {
        // Retire the undersized one so it cannot be typed into the manual promo
        // box after we have stopped pointing at it.
        try {
          await stripe().promotionCodes.update(promo.id, { active: false })
        } catch {
          /* a code we cannot deactivate is still one we no longer hand out */
        }
      }
    }

    const code = await createHostCompCode(venues[0].name, allowance)
    await admin
      .from('venues')
      .update({ comp_promo_code: code })
      .in(
        'id',
        venues.map((v) => v.id)
      )
    return code
  } catch {
    return null
  }
}

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
export async function createHostCompCode(
  businessName: string,
  // Defaults to the one-screen host's allowance so existing callers keep their
  // old behaviour; ensureHostCompCode() passes the host's real number.
  maxRedemptions: number = FREE_SCREENS_PER_HOSTED_TV
): Promise<string> {
  const s = stripe()
  await ensureHostCompCoupon()
  const base = codeBaseFromName(businessName)
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = attempt === 0 ? base : `${base}${randSuffix()}`
    try {
      const promo = await s.promotionCodes.create({
        promotion: { type: 'coupon', coupon: HOST_COMP_COUPON_ID },
        code,
        // A backstop, not the enforcement. One redemption is one CHECKOUT however
        // many screens were in it, so this cannot cap screens; it is set to the
        // allowance purely so a host taking their screens one at a time never
        // runs the code out. hostFreeScreenUsage() limits the screens.
        max_redemptions: Math.max(1, maxRedemptions),
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


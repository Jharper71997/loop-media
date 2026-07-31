// Move a campaign subscription's monthly screen charge to a new amount.
//
// The monthly bill is a single recurring item whose price AND product were minted
// inline by Checkout via `product_data`. Stripe treats those auto-created products
// as read-only: they cannot be updated or un-archived, and attaching a new price to
// one fails with "product ... is marked as inactive". So we must NOT reuse
// item.price.product — that errors on every live subscription. Mint a fresh
// product+price instead and point the item at it. With a creative-refresh add-on
// there are two recurring items; the screens item is the one that isn't the refresh.
//
// `proration` is deliberately the caller's decision:
//   'none'              — the difference was already charged up front (screen ADDS,
//                         which take payment in Checkout before anything goes live)
//   'create_prorations' — stage the difference on the next invoice (screen REMOVALS,
//                         where policy is a credit toward future billing)
//
// Server-only. Throws on any Stripe error so the caller decides what that means.

import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { CREATIVE_REFRESH_CENTS } from '@/lib/fees'

/** Invoice-facing name, matching what Checkout writes at signup. */
export function screenLabel(screens: number): string {
  return `Loop Network: ${screens} screen${screens === 1 ? '' : 's'}`
}

export async function setSubscriptionMonthlyCents(
  subId: string,
  totalCents: number,
  proration: Stripe.SubscriptionUpdateParams.ProrationBehavior,
  label = 'Loop Network: monthly screens'
): Promise<boolean> {
  const sub = await stripe().subscriptions.retrieve(subId)
  const recurring = sub.items.data.filter((i) => i.price.recurring)
  const item =
    recurring.length <= 1
      ? (recurring[0] ?? sub.items.data[0])
      : (recurring.find((i) => i.price.unit_amount !== CREATIVE_REFRESH_CENTS) ?? recurring[0])
  if (!item) return false

  const price = await stripe().prices.create({
    currency: 'usd',
    unit_amount: totalCents,
    recurring: { interval: 'month' },
    product_data: { name: label },
  })

  await stripe().subscriptions.update(subId, {
    items: [{ id: item.id, price: price.id }],
    proration_behavior: proration,
  })
  return true
}

// Move a campaign subscription's monthly screen charge to a new amount.
//
// The monthly bill is a single INLINE-price recurring item (there's no reusable
// Price object to swap to), so changing the amount means replacing that item's
// price_data with a new inline price. With a creative-refresh add-on there are two
// recurring items; the screens item is the one that isn't the refresh.
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

export async function setSubscriptionMonthlyCents(
  subId: string,
  totalCents: number,
  proration: Stripe.SubscriptionUpdateParams.ProrationBehavior
): Promise<boolean> {
  const sub = await stripe().subscriptions.retrieve(subId)
  const recurring = sub.items.data.filter((i) => i.price.recurring)
  const item =
    recurring.length <= 1
      ? (recurring[0] ?? sub.items.data[0])
      : (recurring.find((i) => i.price.unit_amount !== CREATIVE_REFRESH_CENTS) ?? recurring[0])
  if (!item) return false

  const product = typeof item.price.product === 'string' ? item.price.product : item.price.product.id
  await stripe().subscriptions.update(subId, {
    items: [
      {
        id: item.id,
        price_data: {
          currency: 'usd',
          product,
          unit_amount: totalCents,
          recurring: { interval: 'month' },
        },
      },
    ],
    proration_behavior: proration,
  })
  return true
}

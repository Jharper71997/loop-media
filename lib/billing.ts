// Billing truth for a hand-sold network.
//
// Loop Network does NOT run like the self-serve marketplace the schema was first
// shaped for. Most accounts are sold in person: the ad is built for the
// advertiser, and they pay by check, by a Stripe subscription that lives on
// another account, or not at all (a comp). Only some go through the app's own
// Stripe Checkout.
//
// Nothing in the schema records "how does this account pay" — so this module
// DERIVES it from what already exists (no migration required):
//
//   comp      campaigns.comp_until is set. The place cron stops the ad on its own
//             when that date passes, so a comp is self-expiring.
//   stripe    the subscription carries a stripe_subscription_id. Period end is
//             authoritative and the webhook keeps it fresh.
//   manual    a real subscription with no Stripe id — check, cash, or a sub billed
//             on a different Stripe account. Paid-through comes from the
//             subscription's current_period_end when an admin set one, else from
//             the last payments-ledger row + one month.
//   unbilled  a live campaign with no comp, no Stripe id, and no payment on file.
//             This is money on the floor, and it is what the Today page surfaces.
//
// IMPORTANT: never resolve a lapsed manual/check account by setting the
// subscription to 'canceled'. Canceling wipes its placement_snapshots, which is
// what the advertiser's own report is built from — the account's whole history
// disappears. Record a payment, or pause the campaign instead.

import { DEFAULT_SETTINGS } from '@/lib/settings'

export type BillingMethod = 'stripe' | 'manual' | 'comp' | 'unbilled'

// How urgent this account is, worst-first. 'unbilled' outranks 'overdue' because
// an unbilled live ad has never produced a dollar.
export type BillingHealth = 'unbilled' | 'overdue' | 'due' | 'ok'

export const BILLING_METHOD_LABEL: Record<BillingMethod, string> = {
  stripe: 'Stripe',
  manual: 'Check / cash',
  comp: 'Comped',
  unbilled: 'Not billed',
}

// These three are admin-editable — the live values come from getSettings()
// (lib/settings.server.ts), and what is re-exported here is the DEFAULT that
// applies when nothing has been saved. They are aliased rather than redeclared
// so the registry and the billing code can never drift to different numbers.
//
//   DUE_SOON_DAYS   a manual account inside this many days of its paid-through
//                   date needs an invoice sent now, not on the day it lapses.
//   MRR_GOAL_*      the number the year is measured against, and when it is due.
export const DUE_SOON_DAYS = DEFAULT_SETTINGS.due_soon_days
export const MRR_GOAL_CENTS = DEFAULT_SETTINGS.mrr_goal_cents
export const MRR_GOAL_LABEL = DEFAULT_SETTINGS.mrr_goal_label

export interface BillingInput {
  campaignStatus: string
  compUntil: string | null
  stripeSubscriptionId: string | null
  subscriptionStatus: string | null
  currentPeriodEnd: string | null
  // Most recent row in `payments` for this campaign/advertiser, if any.
  lastPaidAt: string | null
}

export interface BillingState {
  method: BillingMethod
  paidThrough: string | null
  daysLeft: number | null
  health: BillingHealth
  // One short phrase for a table cell — "Comped, 12 days left", "Check, overdue 4 days".
  summary: string
}

const DAY_MS = 86_400_000

// One month on from `iso`, clamped to the end of a short month (Jan 31 + 1mo =
// Feb 28/29, not Mar 3). This is the assumed cover period of a single check.
export function addOneMonth(iso: string): string {
  const d = new Date(iso)
  const day = d.getUTCDate()
  const target = new Date(d)
  target.setUTCDate(1)
  target.setUTCMonth(target.getUTCMonth() + 1)
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target.toISOString()
}

export function resolveBilling(
  input: BillingInput,
  nowMs = Date.now(),
  // Callers on the server pass the live setting; the default keeps this function
  // pure and usable from a Client Component.
  dueSoonDays: number = DUE_SOON_DAYS
): BillingState {
  const method: BillingMethod = input.compUntil
    ? 'comp'
    : input.stripeSubscriptionId
      ? 'stripe'
      : input.currentPeriodEnd || input.lastPaidAt
        ? 'manual'
        : 'unbilled'

  const paidThrough =
    method === 'comp'
      ? input.compUntil
      : method === 'stripe'
        ? input.currentPeriodEnd
        : method === 'manual'
          ? (input.currentPeriodEnd ?? (input.lastPaidAt ? addOneMonth(input.lastPaidAt) : null))
          : null

  const daysLeft =
    paidThrough == null
      ? null
      : Math.ceil((new Date(paidThrough).getTime() - nowMs) / DAY_MS)

  const health: BillingHealth =
    method === 'unbilled' || daysLeft == null
      ? 'unbilled'
      : daysLeft < 0
        ? 'overdue'
        : daysLeft <= dueSoonDays
          ? 'due'
          : 'ok'

  return { method, paidThrough, daysLeft, health, summary: summarize(method, health, daysLeft) }
}

function summarize(method: BillingMethod, health: BillingHealth, daysLeft: number | null): string {
  const noun = BILLING_METHOD_LABEL[method]
  if (health === 'unbilled') return method === 'unbilled' ? 'Never billed' : `${noun}, no date set`
  if (daysLeft == null) return noun
  if (health === 'overdue') {
    const n = Math.abs(daysLeft)
    return method === 'comp'
      ? `Comp ended ${n} day${n === 1 ? '' : 's'} ago`
      : `${noun}, ${n} day${n === 1 ? '' : 's'} overdue`
  }
  if (daysLeft === 0) return method === 'comp' ? 'Comp ends today' : `${noun}, due today`
  return method === 'comp'
    ? `Comped, ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
    : `${noun}, ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
}

// What to do about this account, in the operator's words. Drives the Today list
// and the Money page's action column.
export function billingAction(state: BillingState): string | null {
  switch (state.health) {
    case 'unbilled':
      return 'Set up billing'
    case 'overdue':
      return state.method === 'comp' ? 'Convert to paid' : 'Record payment'
    case 'due':
      return state.method === 'comp' ? 'Convert before it ends' : 'Send invoice'
    default:
      return null
  }
}

// Badge tone for a health value, matching the Badge variants used across admin.
export const HEALTH_VARIANT: Record<BillingHealth, 'destructive' | 'warning' | 'success' | 'secondary'> = {
  unbilled: 'destructive',
  overdue: 'destructive',
  due: 'warning',
  ok: 'success',
}

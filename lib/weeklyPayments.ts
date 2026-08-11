// The Monday money email: everyone who paid in the last 7 days, across both
// businesses, in one place.
//
// WHY THIS IS NOT A SINGLE STRIPE QUERY: the money arrives on TWO Stripe
// accounts and one of them holds BOTH businesses.
//
//   acct_1Tni3R  "Loop Network"     STRIPE_SECRET_KEY        Loop Network only
//   acct_1StHRRR "Jville Brew Loop" BREW_STRIPE_SECRET_KEY   Brew Loop riders AND
//                                                            the legacy TV sponsors
//                                                            sold before the repoint
//
// So a charge landing on the Brew account is not automatically Brew Loop revenue.
// classify() below decides which business each one belongs to. On top of that,
// several Loop Network sponsors pay by check and never touch Stripe at all, so
// the `payments` ledger is a third source that has to be folded in.
//
// Both env keys are read independently and either may be missing. When only one
// is set the report still sends, with a visible note saying which account could
// not be read, because a silently half empty money email is worse than none.

import Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatCents } from '@/lib/format'
import { escapeHtml } from '@/lib/emailSettings'

export type Business = 'loop-network' | 'brew-loop'

export interface PaymentRow {
  business: Business
  name: string
  email: string | null
  // "Ticket order", "Subscription", "Check" ... what the money was for.
  kind: string
  amountCents: number
  paidAt: string
  // Where it came from, for the footer reconciliation line.
  source: 'stripe-loop-network' | 'stripe-brew' | 'ledger'
}

export interface WeeklyPayments {
  start: string
  end: string
  label: string
  rows: PaymentRow[]
  loopNetworkCents: number
  brewLoopCents: number
  totalCents: number
  // Active, non demo, non comped campaigns. Matches the Money page's billed MRR.
  loopNetworkMrrCents: number
  // Non fatal problems worth printing in the email rather than swallowing.
  warnings: string[]
}

const DAY_MS = 86_400_000

// Stripe's own paging tops out at 100. A week of Brew Loop ticket sales can beat
// that in a busy weekend, so every list is walked to the end rather than sliced.
async function allCharges(key: string, sinceSec: number, untilSec: number) {
  const stripe = new Stripe(key)
  const out: Stripe.Charge[] = []
  for await (const c of stripe.charges.list({
    limit: 100,
    created: { gte: sinceSec, lt: untilSec },
    expand: ['data.customer'],
  })) {
    out.push(c)
  }
  return out
}

function customerOf(c: Stripe.Charge): Stripe.Customer | null {
  const cu = c.customer
  if (!cu || typeof cu === 'string' || cu.deleted) return null
  return cu
}

function nameOf(c: Stripe.Charge): string {
  const cu = customerOf(c)
  return cu?.name || c.billing_details?.name || cu?.email || c.billing_details?.email || 'Unknown'
}

function emailOf(c: Stripe.Charge): string | null {
  const cu = customerOf(c)
  return cu?.email || c.billing_details?.email || null
}

// What the money was for, in the operator's words rather than Stripe's.
// Stripe writes "Subscription update" for a sponsor's monthly bill and "Order for
// Jville Brew Loop - Friday Night" for a rider, so the raw description is only
// useful after it has been normalised.
function kindOf(c: Stripe.Charge): string {
  const d = (c.description ?? '').trim()
  if (/^subscription/i.test(d)) return 'Monthly ad'
  if (/^order for/i.test(d)) return d.replace(/^order for\s+/i, '')
  // Ticket Tailor names the night it was bought for, which reads better than
  // Stripe's empty description.
  const event = c.metadata?.event_name
  if (event) return event
  return d || 'Card payment'
}

// Which business a charge on the BREW account belongs to.
//
// Only definitive signals are used, in order:
//   Ticket Tailor metadata   a rider bought a seat, nothing else writes it
//   "Order for ..."          the app's own checkout, also a rider
//   "Subscription ..."       a legacy TV sponsor's monthly bill; riders pay one off
//                            and never generate a subscription charge
//   known Stripe customer    the id came off an actual Loop Network subscription row
//
// Matching the payer's EMAIL against the advertiser list was tried and removed:
// advertisers ride the shuttle too, so it filed a sponsor's personal ticket
// purchase as ad revenue. It also earned nothing, because every real sponsor is
// already caught by the subscription test. Anything left over is treated as Brew
// Loop, which is what an unlabelled charge on the Brew account almost always is.
function isLegacySponsor(c: Stripe.Charge, lnCustomers: Set<string>): boolean {
  const meta = c.metadata ?? {}
  if (meta.TicketTailor || meta.event_id || meta.event_name) return false
  const d = (c.description ?? '').trim()
  if (/^order for/i.test(d)) return false
  if (/^subscription/i.test(d)) return true
  const cu = c.customer
  const id = typeof cu === 'string' ? cu : cu?.id
  return !!id && lnCustomers.has(id)
}

export function weekWindow(nowMs: number, days = 7): { start: string; end: string; label: string } {
  const end = new Date(nowMs)
  const start = new Date(nowMs - days * DAY_MS)
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    label: `${fmt(start)} to ${fmt(end)}`,
  }
}

export async function buildWeeklyPayments(
  admin: SupabaseClient,
  nowMs = Date.now(),
  // Only ever overridden from the route's test parameters, so a wider window can
  // be checked by hand without waiting a week for real data to accumulate.
  days = 7
): Promise<WeeklyPayments> {
  const { start, end, label } = weekWindow(nowMs, days)
  const sinceSec = Math.floor(new Date(start).getTime() / 1000)
  const untilSec = Math.floor(new Date(end).getTime() / 1000)
  const warnings: string[] = []

  // Who counts as a Loop Network advertiser, so a charge on the Brew account can
  // be attributed correctly.
  const [subsRes, campRes] = await Promise.all([
    admin.from('subscriptions').select('stripe_customer_id, advertiser_id'),
    admin.from('campaigns').select('monthly_total_cents, status, comp_until, is_demo'),
  ])

  // If either lookup fails the report still builds, but every Brew account charge
  // would fall back to the description test alone and a real sponsor could be
  // filed under Brew Loop. Say so rather than quietly mislabelling the money.
  if (subsRes.error) warnings.push(`Advertiser list could not be read: ${subsRes.error.message}`)
  if (campRes.error) warnings.push(`Campaign list could not be read: ${campRes.error.message}`)

  const lnCustomers = new Set(
    ((subsRes.data ?? []) as { stripe_customer_id: string | null }[])
      .map((s) => s.stripe_customer_id)
      .filter((v): v is string => !!v)
  )
  type CampRow = {
    monthly_total_cents: number | null
    status: string
    comp_until: string | null
    is_demo: boolean
  }
  const camps = (campRes.data ?? []) as CampRow[]

  // Billed MRR, same rule the Money page uses: live, real, and actually paying.
  const loopNetworkMrrCents = camps
    .filter((c) => !c.is_demo && c.status === 'active' && !c.comp_until)
    .reduce((a, c) => a + (c.monthly_total_cents ?? 0), 0)

  const rows: PaymentRow[] = []

  // ── Stripe: the Loop Network account ──────────────────────────────────────
  const lnKey = process.env.STRIPE_SECRET_KEY
  const brewKey = process.env.BREW_STRIPE_SECRET_KEY
  // If the two env vars ever resolve to the SAME Stripe account, every charge on
  // it would be counted once per pass and the email would report double the money
  // that came in. Comparing the key strings is not enough, because two different
  // keys (a restricted one and a secret one) can point at the same account, which
  // is exactly the state the local .env files are in today. So charges are
  // deduped by their own id, which is what actually identifies a payment.
  const seenCharges = new Set<string>()

  if (lnKey) {
    try {
      for (const c of await allCharges(lnKey, sinceSec, untilSec)) {
        if (c.status !== 'succeeded' || seenCharges.has(c.id)) continue
        seenCharges.add(c.id)
        const net = c.amount_captured - c.amount_refunded
        if (net <= 0) continue
        rows.push({
          business: 'loop-network',
          name: nameOf(c),
          email: emailOf(c),
          kind: kindOf(c),
          amountCents: net,
          paidAt: new Date(c.created * 1000).toISOString(),
          source: 'stripe-loop-network',
        })
      }
    } catch (e) {
      warnings.push(`Loop Network Stripe could not be read: ${msg(e)}`)
    }
  } else {
    warnings.push('STRIPE_SECRET_KEY is not set, so Loop Network card payments are missing.')
  }

  // ── Stripe: the Brew account, split across both businesses ────────────────
  if (brewKey) {
    try {
      let overlap = 0
      for (const c of await allCharges(brewKey, sinceSec, untilSec)) {
        if (c.status !== 'succeeded') continue
        if (seenCharges.has(c.id)) {
          overlap++
          continue
        }
        seenCharges.add(c.id)
        const net = c.amount_captured - c.amount_refunded
        if (net <= 0) continue
        const sponsor = isLegacySponsor(c, lnCustomers)
        rows.push({
          business: sponsor ? 'loop-network' : 'brew-loop',
          name: nameOf(c),
          email: emailOf(c),
          kind: kindOf(c),
          amountCents: net,
          paidAt: new Date(c.created * 1000).toISOString(),
          source: 'stripe-brew',
        })
      }
      // Any overlap at all means both keys are on one account, so one of the two
      // businesses is not really being read. Worth saying out loud in the email.
      if (overlap > 0) {
        warnings.push(
          'Both Stripe keys point at the same account, so one of the two businesses is missing from this report.'
        )
      }
    } catch (e) {
      warnings.push(`Brew Loop Stripe could not be read: ${msg(e)}`)
    }
  } else {
    warnings.push('BREW_STRIPE_SECRET_KEY is not set, so Brew Loop ticket sales are missing.')
  }

  // ── The payments ledger: checks, cash, and anything billed off Stripe ──────
  // Rows written from a Stripe webhook are skipped, otherwise they would be
  // counted a second time alongside the charge they came from.
  const { data: ledger, error: ledgerErr } = await admin
    .from('payments')
    .select('amount_cents, paid_at, source, advertiser:profiles!advertiser_id(full_name, email)')
    .gte('paid_at', start)
    .lt('paid_at', end)
  if (ledgerErr) warnings.push(`Check payments could not be read: ${ledgerErr.message}`)

  type LedgerRow = {
    amount_cents: number | null
    paid_at: string
    source: string | null
    advertiser: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null
  }
  for (const p of (ledger ?? []) as LedgerRow[]) {
    if ((p.source ?? '').toLowerCase() === 'stripe') continue
    const a = Array.isArray(p.advertiser) ? p.advertiser[0] : p.advertiser
    rows.push({
      business: 'loop-network',
      name: a?.full_name || a?.email || 'Unknown',
      email: a?.email ?? null,
      kind: p.source ? capitalize(p.source) : 'Offline',
      amountCents: p.amount_cents ?? 0,
      paidAt: p.paid_at,
      source: 'ledger',
    })
  }

  rows.sort((a, b) => b.amountCents - a.amountCents)
  const sum = (b: Business) =>
    rows.filter((r) => r.business === b).reduce((a, r) => a + r.amountCents, 0)
  const loopNetworkCents = sum('loop-network')
  const brewLoopCents = sum('brew-loop')

  return {
    start,
    end,
    label,
    rows,
    loopNetworkCents,
    brewLoopCents,
    totalCents: loopNetworkCents + brewLoopCents,
    loopNetworkMrrCents,
    warnings,
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function weeklyPaymentsSubject(r: WeeklyPayments): string {
  return `Paid this week: ${formatCents(r.totalCents)} (${r.label})`
}

// Inline styled HTML so it renders across email clients. No dashes in copy.
export function renderWeeklyPaymentsHtml(r: WeeklyPayments): string {
  const section = (title: string, business: Business, cents: number, sub: string) => {
    const items = r.rows.filter((x) => x.business === business)
    const body = items.length
      ? items
          .map(
            (p) => `
        <tr>
          <td style="padding:10px 0;border-top:1px solid #27272a;">
            <div style="font-weight:600;color:#fafafa;font-size:14px;">${escapeHtml(p.name)}</div>
            <div style="margin-top:3px;color:#a1a1aa;font-size:12px;">${escapeHtml(p.kind)}${
              p.email ? ` &middot; ${escapeHtml(p.email)}` : ''
            }</div>
          </td>
          <td align="right" style="padding:10px 0;border-top:1px solid #27272a;white-space:nowrap;color:#fafafa;font-size:14px;font-weight:600;vertical-align:top;">
            ${formatCents(p.amountCents)}
          </td>
        </tr>`
          )
          .join('')
      : `<tr><td colspan="2" style="padding:12px 0;border-top:1px solid #27272a;color:#71717a;font-size:13px;">Nothing came in this week.</td></tr>`

    return `
      <div style="margin-top:28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="color:#fafafa;font-size:16px;font-weight:700;">${escapeHtml(title)}</td>
            <td align="right" style="color:#fafafa;font-size:16px;font-weight:700;">${formatCents(cents)}</td>
          </tr>
          <tr><td colspan="2" style="padding-top:2px;color:#71717a;font-size:12px;">${escapeHtml(sub)}</td></tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
          ${body}
        </table>
      </div>`
  }

  const lnCount = r.rows.filter((x) => x.business === 'loop-network').length
  const brewCount = r.rows.filter((x) => x.business === 'brew-loop').length

  const warningHtml = r.warnings.length
    ? `<div style="margin-top:24px;padding:12px 14px;background:#2a1a10;border:1px solid #7c4a13;border-radius:10px;color:#fbbf24;font-size:12px;line-height:1.6;">
         <strong>Heads up, this report is incomplete:</strong><br/>${r.warnings
           .map((w) => escapeHtml(w))
           .join('<br/>')}
       </div>`
    : ''

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0a0a0b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#0a0a0b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
            <tr>
              <td>
                <div style="color:#71717a;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Weekly payments</div>
                <div style="margin-top:6px;color:#fafafa;font-size:28px;font-weight:700;">${formatCents(r.totalCents)}</div>
                <div style="margin-top:4px;color:#a1a1aa;font-size:13px;">
                  ${escapeHtml(r.label)} &middot; ${r.rows.length} payment${r.rows.length === 1 ? '' : 's'}
                </div>

                ${section('Loop Network', 'loop-network', r.loopNetworkCents, `${lnCount} payment${lnCount === 1 ? '' : 's'} · billed MRR ${formatCents(r.loopNetworkMrrCents)}`)}
                ${section('Jville Brew Loop', 'brew-loop', r.brewLoopCents, `${brewCount} payment${brewCount === 1 ? '' : 's'} · tickets and rider orders`)}

                ${warningHtml}

                <div style="margin-top:28px;padding-top:14px;border-top:1px solid #27272a;color:#52525b;font-size:11px;line-height:1.6;">
                  Card payments come from both Stripe accounts, net of refunds. Check and cash payments come from the Loop Network ledger.
                  Legacy TV sponsors still billing on the Brew Loop Stripe account are counted under Loop Network.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

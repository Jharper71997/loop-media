import Link from 'next/link'
import { AlertCircle, DollarSign, TrendingUp, Users, Gift } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ExportCsvButton } from '@/components/admin/ExportCsvButton'
import { formatCents, formatNumber, formatDateTime } from '@/lib/format'
import { loadBillingRows } from '@/lib/adminInbox'
import { BILLING_METHOD_LABEL, HEALTH_VARIANT, billingAction, MRR_GOAL_CENTS } from '@/lib/billing'
import { ActivateButton } from '../revenue/ActivateButton'
import { AccountActions } from './AccountActions'

// Money, as this network actually collects it.
//
// The old Revenue page assumed every dollar arrived through this app's Stripe
// Checkout, so a check-paying advertiser looked identical to one who had never
// paid, and a comp looked like revenue. This page derives how each account pays
// (see lib/billing.ts) and puts the accounts that need chasing at the top, each
// with the action that resolves it.

export default async function MoneyPage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  const rows = await loadBillingRows(t)

  // Cash actually received, from the ledger the Stripe webhook and the
  // record-payment action both write to.
  let pq = supabase.from('payments').select('advertiser_id, amount_cents, paid_at, source')
  if (t) pq = pq.eq('territory_id', t)
  const { data: payData } = await pq
  const payments = (payData ?? []) as {
    advertiser_id: string | null
    amount_cents: number
    paid_at: string
    source: string
  }[]

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
  const sum = (list: typeof payments) => list.reduce((a, p) => a + (p.amount_cents ?? 0), 0)
  const collectedAllTime = sum(payments)
  const thisMonth = sum(payments.filter((p) => p.paid_at >= monthStart))
  const lastMonth = sum(payments.filter((p) => p.paid_at >= lastMonthStart && p.paid_at < monthStart))
  const momPct = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null
  const payingAdvertisers = new Set(payments.map((p) => p.advertiser_id).filter(Boolean)).size

  const billed = rows.filter((r) => r.billing.method !== 'comp' && r.billing.method !== 'unbilled')
  const mrr = billed.reduce((a, r) => a + r.monthlyCents, 0)
  const compedMrr = rows
    .filter((r) => r.billing.method === 'comp')
    .reduce((a, r) => a + r.monthlyCents, 0)
  const atRisk = rows.filter((r) => r.billing.health !== 'ok')
  const atRiskCents = atRisk.reduce((a, r) => a + r.monthlyCents, 0)

  // Paid at checkout but stuck in draft — the Stripe webhook never landed.
  let subQ = supabase
    .from('subscriptions')
    .select('id, campaign_id, campaign:campaigns(id, status, is_demo, monthly_total_cents, ad:ads(title))')
    .in('status', ['active', 'past_due'])
  if (t) subQ = subQ.eq('territory_id', t)
  const { data: subData } = await subQ
  const stuck = ((subData ?? []) as unknown as {
    campaign_id: string | null
    campaign: { id: string; status: string; is_demo: boolean; monthly_total_cents: number | null; ad: { title: string } | null } | null
  }[])
    .map((s) => ({ ...s, campaign: Array.isArray(s.campaign) ? s.campaign[0] : s.campaign }))
    .filter((s) => s.campaign && s.campaign.status === 'draft' && !s.campaign.is_demo)

  const byMethod = rows.reduce<Record<string, { count: number; cents: number }>>((acc, r) => {
    const k = r.billing.method
    acc[k] = { count: (acc[k]?.count ?? 0) + 1, cents: (acc[k]?.cents ?? 0) + r.monthlyCents }
    return acc
  }, {})

  const csvRows = rows.map((r) => ({
    advertiser: r.advertiserName,
    ad: r.adTitle,
    monthly_usd: (r.monthlyCents / 100).toFixed(2),
    method: BILLING_METHOD_LABEL[r.billing.method],
    paid_through: r.billing.paidThrough ? r.billing.paidThrough.slice(0, 10) : '',
    status: r.billing.health,
  }))

  return (
    <>
      <PageHeader
        title="Money"
        description={
          atRisk.length === 0
            ? 'Every live account is paid up'
            : `${atRisk.length} account${atRisk.length === 1 ? '' : 's'} need attention · ${formatCents(atRiskCents)}/mo`
        }
        action={<ExportCsvButton filename="loop-accounts.csv" rows={csvRows} />}
      />

      <div className="space-y-6 p-5 md:p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Collected this month"
            value={formatCents(thisMonth)}
            sub={
              momPct != null
                ? `${momPct >= 0 ? '+' : ''}${momPct}% vs ${formatCents(lastMonth)} last month`
                : 'No comparison yet'
            }
            icon={DollarSign}
          />
          <Stat
            label="Billed MRR"
            value={formatCents(mrr)}
            sub={`${billed.length} paying account${billed.length === 1 ? '' : 's'} · ${Math.round((mrr / MRR_GOAL_CENTS) * 100)}% of goal`}
            icon={TrendingUp}
          />
          <Stat
            label="Running comped"
            value={formatCents(compedMrr)}
            sub={`${byMethod.comp?.count ?? 0} account${(byMethod.comp?.count ?? 0) === 1 ? '' : 's'} on air for free`}
            icon={Gift}
          />
          <Stat
            label="Collected all-time"
            value={formatCents(collectedAllTime)}
            sub={`${formatNumber(payingAdvertisers)} advertiser${payingAdvertisers === 1 ? '' : 's'} have paid`}
            icon={Users}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Collected</span> is money in the ledger —
          Stripe webhooks and checks you logged.{' '}
          <span className="font-medium text-foreground">Billed MRR</span> is the recurring value of
          accounts that actually pay; comps are counted separately so a free ad never reads as
          revenue.
        </p>

        {/* ---- Paid but never activated ---- */}
        {stuck.length > 0 && (
          <Card>
            <CardContent className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <AlertCircle className="size-4 text-warning" />
                <p className="text-sm font-medium">Paid at checkout, never activated</p>
              </div>
              <p className="mb-3 text-xs text-muted-foreground">
                These went through Stripe Checkout but their campaign is still draft — the webhook
                probably never fired. Nothing is on screen until you activate.
              </p>
              <ul className="space-y-2">
                {stuck.map((s) => (
                  <li
                    key={s.campaign_id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                  >
                    <span className="text-sm">
                      <span className="font-medium">{s.campaign?.ad?.title ?? 'Campaign'}</span>
                      <span className="text-muted-foreground">
                        {' · '}
                        {formatCents(s.campaign?.monthly_total_cents ?? 0)}/mo
                      </span>
                    </span>
                    {s.campaign_id && <ActivateButton campaignId={s.campaign_id} />}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* ---- Every live account ---- */}
        <div>
          <h2 className="mb-3 text-sm font-medium">
            Live accounts
            <span className="ml-2 font-normal text-muted-foreground">
              worst first — unbilled, then overdue, then due soon
            </span>
          </h2>

          {rows.length === 0 ? (
            <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              No live campaigns yet.{' '}
              <Link href="/admin/deals/new" className="text-primary hover:underline">
                Set up your first deal
              </Link>
              .
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => {
                const cta = billingAction(r.billing)
                return (
                  <div
                    key={r.campaignId}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/admin/advertisers/${r.advertiserId}`}
                          className="truncate font-medium hover:underline"
                        >
                          {r.advertiserName}
                        </Link>
                        <Badge variant={HEALTH_VARIANT[r.billing.health]}>
                          {BILLING_METHOD_LABEL[r.billing.method]}
                        </Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.adTitle} · {r.billing.summary}
                        {r.billing.paidThrough &&
                          ` · through ${formatDateTime(r.billing.paidThrough)}`}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {formatCents(r.monthlyCents)}/mo
                    </span>
                    {cta && (
                      <span className="hidden shrink-0 text-xs font-medium text-warning sm:inline">
                        {cta}
                      </span>
                    )}
                    <AccountActions
                      campaignId={r.campaignId}
                      advertiserName={r.advertiserName}
                      monthlyCents={r.monthlyCents}
                      method={r.billing.method}
                      paidThrough={r.billing.paidThrough}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function Stat({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string
  value: string
  sub: string
  icon: typeof DollarSign
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-muted-foreground">{label}</p>
          <Icon className="size-4 shrink-0 text-muted-foreground" />
        </div>
        <p className="mt-1 font-heading text-2xl font-bold tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  )
}

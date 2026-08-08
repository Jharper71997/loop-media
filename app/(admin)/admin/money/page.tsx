import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, MONEY_TABS } from '@/components/admin/SectionTabs'
import { Badge } from '@/components/ui/badge'
import { ExportCsvButton } from '@/components/admin/ExportCsvButton'
import { HudBody, StatStrip, Stat, Panel, Num } from '@/components/admin/hud'
import { formatCents, formatNumber, formatDateTime } from '@/lib/format'
import { loadBillingRows } from '@/lib/adminInbox'
import { BILLING_METHOD_LABEL, HEALTH_VARIANT, billingAction } from '@/lib/billing'
import { getSettings } from '@/lib/settings.server'
import { ActivateButton } from '../revenue/ActivateButton'
import { AccountActions } from './AccountActions'

// Money, as this network actually collects it.
//
// The old Revenue page assumed every dollar arrived through this app's Stripe
// Checkout, so a check-paying advertiser looked identical to one who had never
// paid, and a comp looked like revenue. This page derives how each account pays
// (see lib/billing.ts) and puts the accounts that need chasing at the top, each
// with the action that resolves it.
//
// The Collected-vs-MRR distinction used to be a paragraph under the numbers. It
// is now the hover title on each stat: the definition is still one gesture away,
// but it no longer costs three lines of the screen every time you load the page.

export default async function MoneyPage({
  searchParams,
}: {
  // `?campaign=` is how every case page hands off ("Convert them to paid",
  // "Record the payment"). Without it the link landed on the full unfiltered
  // list and you had to find the account again by eye.
  searchParams?: Promise<{ campaign?: string }>
}) {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()
  const focusCampaign = (await searchParams)?.campaign ?? null

  const [allRows, settings] = await Promise.all([loadBillingRows(t), getSettings()])
  // Keep the worst-first order, but float the account you were sent here for.
  const rows = focusCampaign
    ? [
        ...allRows.filter((r) => r.campaignId === focusCampaign),
        ...allRows.filter((r) => r.campaignId !== focusCampaign),
      ]
    : allRows
  const focusName = focusCampaign
    ? (allRows.find((r) => r.campaignId === focusCampaign)?.advertiserName ?? null)
    : null

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
      <SectionTabs tabs={MONEY_TABS} />

      <HudBody>
        <StatStrip cols={5}>
          <Stat
            label="Collected"
            value={formatCents(thisMonth)}
            sub={
              momPct != null
                ? `${momPct >= 0 ? '+' : ''}${momPct}% vs ${formatCents(lastMonth)} last month`
                : 'this month · no comparison yet'
            }
            title="Money in the ledger since the 1st — Stripe webhooks and checks you logged."
          />
          <Stat
            label="Billed MRR"
            value={formatCents(mrr)}
            sub={`${billed.length} paying · ${Math.round((mrr / settings.mrr_goal_cents) * 100)}% of goal`}
            title="Recurring value of accounts that actually pay. Comps are counted separately so a free ad never reads as revenue."
          />
          <Stat
            label="At risk"
            value={formatCents(atRiskCents)}
            sub={`${atRisk.length} account${atRisk.length === 1 ? '' : 's'} unbilled, overdue or due soon`}
            tone={atRiskCents > 0 ? 'bad' : 'good'}
            title="Live on screen but not paid up. Every one of these is on air costing you inventory."
          />
          <Stat
            label="Running comped"
            value={formatCents(compedMrr)}
            sub={`${byMethod.comp?.count ?? 0} account${(byMethod.comp?.count ?? 0) === 1 ? '' : 's'} on air for free`}
            title="Deliberately excluded from MRR."
          />
          <Stat
            label="All-time"
            value={formatCents(collectedAllTime)}
            sub={`${formatNumber(payingAdvertisers)} advertiser${payingAdvertisers === 1 ? '' : 's'} have paid`}
          />
        </StatStrip>

        {/* ---- Paid but never activated ---- */}
        {stuck.length > 0 && (
          <Panel
            title="Paid at checkout, never activated"
            note={`${stuck.length} stuck`}
            bodyClassName="p-0"
          >
            <p className="border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
              <AlertCircle className="mr-1 inline size-3 text-warning" />
              These went through Stripe Checkout but their campaign is still draft — the webhook
              probably never fired. Nothing is on screen until you activate.
            </p>
            <ul className="divide-y divide-border">
              {stuck.map((s) => (
                <li
                  key={s.campaign_id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5"
                >
                  <span className="text-[13px]">
                    <span className="font-medium">{s.campaign?.ad?.title ?? 'Campaign'}</span>
                    <span className="text-muted-foreground">
                      {' · '}
                      <Num>{formatCents(s.campaign?.monthly_total_cents ?? 0)}</Num>/mo
                    </span>
                  </span>
                  {s.campaign_id && <ActivateButton campaignId={s.campaign_id} />}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {/* ---- Every live account ---- */}
        <Panel
          title="Live accounts"
          note={
            focusName
              ? `${focusName} first — worst first below`
              : 'worst first — unbilled, then overdue, then due soon'
          }
          action={
            focusCampaign ? (
              <Link href="/admin/money" className="text-xs text-muted-foreground hover:underline">
                Clear
              </Link>
            ) : undefined
          }
          bodyClassName="p-0"
        >
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No live campaigns yet.{' '}
              <Link href="/admin/deals/new" className="text-primary hover:underline">
                Set up your first deal
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => {
                const cta = billingAction(r.billing)
                return (
                  <li
                    key={r.campaignId}
                    className={
                      'flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2' +
                      (r.campaignId === focusCampaign ? ' bg-primary/10' : '')
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/admin/advertisers/${r.advertiserId}`}
                          className="truncate text-[13px] font-medium hover:underline"
                        >
                          {r.advertiserName}
                        </Link>
                        <Badge variant={HEALTH_VARIANT[r.billing.health]}>
                          {BILLING_METHOD_LABEL[r.billing.method]}
                        </Badge>
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {r.adTitle} · {r.billing.summary}
                        {r.billing.paidThrough && ` · through ${formatDateTime(r.billing.paidThrough)}`}
                      </p>
                    </div>
                    <Num className="shrink-0 text-[13px] font-semibold">
                      {formatCents(r.monthlyCents)}/mo
                    </Num>
                    {cta && (
                      <span className="hidden shrink-0 text-[11px] font-medium text-warning sm:inline">
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
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </HudBody>
    </>
  )
}

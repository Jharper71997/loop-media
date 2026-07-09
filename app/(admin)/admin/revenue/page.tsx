import { DollarSign, Users, TrendingUp, AlertCircle } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCents, formatNumber } from '@/lib/format'
import { ExportCsvButton } from '@/components/admin/ExportCsvButton'
import { ActivateButton } from './ActivateButton'

type SubRow = {
  id: string
  status: string
  territory_id: string | null
  advertiser_id: string
  campaign_id: string | null
  package_id: string | null
  campaign: {
    id: string
    status: string
    monthly_total_cents: number | null
    is_demo: boolean
    ad: { title: string } | null
  } | null
  package: { name: string } | null
}

export default async function RevenuePage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  let q = supabase
    .from('subscriptions')
    .select(
      'id, status, territory_id, advertiser_id, campaign_id, package_id, campaign:campaigns(id, status, monthly_total_cents, is_demo, ad:ads(title)), package:packages(name)'
    )
    .order('created_at', { ascending: false })
  if (t) q = q.eq('territory_id', t)
  const { data } = await q
  // Drop demo campaigns so they never inflate contracted MRR / pipeline counts.
  const subs = ((data ?? []) as unknown as SubRow[]).filter((s) => !s.campaign?.is_demo)

  // Factual cash collected, from the Stripe payments ledger (webhook-written).
  // Empty until Stripe is connected, so this reads $0 rather than contracted value.
  let pq = supabase.from('payments').select('advertiser_id, amount_cents, paid_at')
  if (t) pq = pq.eq('territory_id', t)
  const { data: payData } = await pq
  const payments = (payData ?? []) as {
    advertiser_id: string | null
    amount_cents: number
    paid_at: string
  }[]
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
  const collectedAllTime = payments.reduce((acc, p) => acc + (p.amount_cents ?? 0), 0)
  const collectedThisMonth = payments
    .filter((p) => p.paid_at >= monthStart)
    .reduce((acc, p) => acc + (p.amount_cents ?? 0), 0)
  const collectedLastMonth = payments
    .filter((p) => p.paid_at >= lastMonthStart && p.paid_at < monthStart)
    .reduce((acc, p) => acc + (p.amount_cents ?? 0), 0)
  // Month-over-month change in collected cash (only meaningful once last month
  // had revenue).
  const momPct =
    collectedLastMonth > 0
      ? Math.round(((collectedThisMonth - collectedLastMonth) / collectedLastMonth) * 100)
      : null
  const payingAdvertisers = new Set(payments.map((p) => p.advertiser_id).filter(Boolean)).size

  // Monthly price per subscription = the cart total frozen at checkout.
  const priceById = new Map<string, number>()
  for (const s of subs) priceById.set(s.id, s.campaign?.monthly_total_cents ?? 0)

  const active = subs.filter((s) => s.status === 'active')
  const mrr = active.reduce((sum, s) => sum + (priceById.get(s.id) ?? 0), 0)

  const counts = subs.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1
    return acc
  }, {})

  // Revenue by territory (only meaningful when viewing "all").
  const byTerritory = new Map<string, number>()
  for (const s of active) {
    const key = s.territory_id ?? 'none'
    byTerritory.set(key, (byTerritory.get(key) ?? 0) + (priceById.get(s.id) ?? 0))
  }
  const territoryName = (id: string) =>
    id === 'none' ? '—' : territory.territories.find((x) => x.id === id)?.name ?? 'Unknown'

  // Paid intent but stuck in draft (webhook never fired) → admin can activate.
  const needsActivation = subs.filter((s) => s.campaign?.status === 'draft')

  const stats: { label: string; value: string; icon: typeof DollarSign; sub?: string }[] = [
    {
      label: 'Collected this month',
      value: formatCents(collectedThisMonth),
      icon: DollarSign,
      sub:
        momPct != null
          ? `${momPct >= 0 ? '+' : ''}${momPct}% vs last month (${formatCents(collectedLastMonth)})`
          : undefined,
    },
    { label: 'Collected all-time', value: formatCents(collectedAllTime), icon: TrendingUp },
    { label: 'Paying advertisers', value: formatNumber(payingAdvertisers), icon: Users },
    { label: 'Contracted MRR (projected)', value: formatCents(mrr), icon: DollarSign },
  ]

  // CSV of every subscription (advertiser-facing figures) for offline reporting.
  const csvRows = subs.map((s) => ({
    ad: s.campaign?.ad?.title ?? 'Campaign',
    status: s.status,
    territory: territoryName(s.territory_id ?? 'none'),
    monthly_usd: ((priceById.get(s.id) ?? 0) / 100).toFixed(2),
  }))

  return (
    <>
      <PageHeader
        title="Revenue"
        description={
          t ? territory.territories.find((x) => x.id === t)?.name : 'All territories'
        }
        action={<ExportCsvButton filename="loop-revenue.csv" rows={csvRows} />}
      />

      <div className="space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label}>
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="text-sm text-muted-foreground">{s.label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
                  {s.sub && <p className="mt-0.5 text-xs text-muted-foreground">{s.sub}</p>}
                </div>
                <s.icon className="size-5 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Collected</span> is money actually received
          through Stripe.{' '}
          <span className="font-medium text-foreground">Contracted MRR</span> is the recurring value
          of active subscriptions — projected, not cash. Subscriptions activated in demo mode or by
          hand have no payment behind them yet.
        </p>

        {/* Subscription status mix */}
        <Card>
          <CardContent className="p-5">
            <p className="mb-3 text-sm font-medium">Subscriptions by status</p>
            {subs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No subscriptions yet.</p>
            ) : (
              <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                {(['active', 'paused', 'past_due', 'incomplete', 'canceled'] as const).map(
                  (st) => (
                    <div key={st}>
                      <span className="capitalize text-muted-foreground">
                        {st.replace('_', ' ')}
                      </span>{' '}
                      <span className="font-medium tabular-nums">{counts[st] ?? 0}</span>
                    </div>
                  )
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Revenue by territory (all-territories view only) */}
        {!t && byTerritory.size > 0 && (
          <Card>
            <CardContent className="p-5">
              <p className="mb-3 text-sm font-medium">MRR by territory</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Territory</TableHead>
                    <TableHead className="text-right">MRR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...byTerritory.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([id, cents]) => (
                      <TableRow key={id}>
                        <TableCell>{territoryName(id)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCents(cents)}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Needs activation */}
        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertCircle className="size-4 text-warning" />
              <p className="text-sm font-medium">Needs activation</p>
            </div>
            {needsActivation.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                All caught up — no paid campaigns are stuck in draft.
              </p>
            ) : (
              <>
                <p className="mb-3 text-xs text-muted-foreground">
                  These campaigns went through checkout but their subscription is still draft
                  (the Stripe webhook may not have fired). Activate to start placement.
                </p>
                <ul className="space-y-2">
                  {needsActivation.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                    >
                      <div className="text-sm">
                        <span className="font-medium">{s.campaign?.ad?.title ?? 'Campaign'}</span>
                        <span className="text-muted-foreground">
                          {' · '}
                          {s.package?.name ?? 'Custom'} · {formatCents(priceById.get(s.id) ?? 0)}/mo
                        </span>
                      </div>
                      {s.campaign_id && <ActivateButton campaignId={s.campaign_id} />}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

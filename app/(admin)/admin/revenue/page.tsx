import { DollarSign, Users, TrendingUp, AlertCircle } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { formatCents, formatNumber } from '@/lib/format'
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
      'id, status, territory_id, advertiser_id, campaign_id, package_id, campaign:campaigns(id, status, monthly_total_cents, ad:ads(title)), package:packages(name)'
    )
    .order('created_at', { ascending: false })
  if (t) q = q.eq('territory_id', t)
  const { data } = await q
  const subs = (data ?? []) as unknown as SubRow[]

  // Monthly price per subscription = the cart total frozen at checkout.
  const priceById = new Map<string, number>()
  for (const s of subs) priceById.set(s.id, s.campaign?.monthly_total_cents ?? 0)

  const active = subs.filter((s) => s.status === 'active')
  const mrr = active.reduce((sum, s) => sum + (priceById.get(s.id) ?? 0), 0)
  const activeAdvertisers = new Set(active.map((s) => s.advertiser_id)).size
  const arpu = activeAdvertisers ? Math.round(mrr / activeAdvertisers) : 0

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

  const stats = [
    { label: 'MRR', value: formatCents(mrr), icon: DollarSign },
    { label: 'Active subscriptions', value: formatNumber(active.length), icon: TrendingUp },
    { label: 'Active advertisers', value: formatNumber(activeAdvertisers), icon: Users },
    { label: 'ARPU', value: formatCents(arpu), icon: DollarSign },
  ]

  return (
    <>
      <PageHeader
        title="Revenue"
        description={
          t ? territory.territories.find((x) => x.id === t)?.name : 'All territories'
        }
      />

      <div className="space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label}>
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="text-sm text-muted-foreground">{s.label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
                </div>
                <s.icon className="size-5 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>

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
              <table className="w-full text-sm">
                <tbody>
                  {[...byTerritory.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([id, cents]) => (
                      <tr key={id} className="border-b border-border/50 last:border-0">
                        <td className="py-2">{territoryName(id)}</td>
                        <td className="py-2 text-right tabular-nums">{formatCents(cents)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* Needs activation */}
        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertCircle className="size-4 text-amber-500" />
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

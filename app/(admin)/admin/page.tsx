import Link from 'next/link'
import {
  DollarSign,
  Inbox,
  Rocket,
  WifiOff,
  Palette,
  Plus,
  PlayCircle,
  Tv,
  ChevronRight,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { formatCents, timeAgo, isTvLive } from '@/lib/format'
import { AutoRefresh } from '@/components/app/AutoRefresh'
import { loadAdminInbox, loadBillingRows, type InboxKind } from '@/lib/adminInbox'
import { loadInventory } from '@/lib/inventory'
import { MRR_GOAL_CENTS, MRR_GOAL_LABEL } from '@/lib/billing'

const KIND_ICON: Record<InboxKind, LucideIcon> = {
  billing: DollarSign,
  activation: Rocket,
  approval: Inbox,
  offline: WifiOff,
  creative: Palette,
}

// Money problems read red; everything else is a neutral to-do.
const KIND_TONE: Record<InboxKind, string> = {
  billing: 'text-destructive',
  activation: 'text-warning',
  approval: 'text-primary',
  offline: 'text-warning',
  creative: 'text-muted-foreground',
}

export default async function AdminToday() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  const [inbox, inventory, billingRows] = await Promise.all([
    loadAdminInbox(t),
    loadInventory(t),
    loadBillingRows(t),
  ])

  // Recurring value of everything that is actually billed. Comps are excluded on
  // purpose — a comped ad is running, but it is not revenue, and folding it into
  // MRR is how a network talks itself into thinking it hit a number it didn't.
  const mrrCents = billingRows
    .filter((r) => r.billing.method !== 'comp' && r.billing.method !== 'unbilled')
    .reduce((a, r) => a + r.monthlyCents, 0)
  const compedCents = billingRows
    .filter((r) => r.billing.method === 'comp')
    .reduce((a, r) => a + r.monthlyCents, 0)
  const goalPct = Math.min(100, Math.round((mrrCents / MRR_GOAL_CENTS) * 100))

  // Cash actually received this calendar month, from the payments ledger.
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  let payQ = supabase.from('payments').select('amount_cents').gte('paid_at', monthStart.toISOString())
  if (t) payQ = payQ.eq('territory_id', t)
  const { data: payData } = await payQ
  const collectedCents = ((payData ?? []) as { amount_cents: number }[]).reduce(
    (a, p) => a + (p.amount_cents ?? 0),
    0
  )

  // What is on air right now — active placements on screens that are checking in.
  const liveTvIds = inventory.rows.flatMap((r) => r.screens.filter((s) => s.live).map((s) => s.id))
  let playing: { title: string; venue: string }[] = []
  if (liveTvIds.length) {
    const { data } = await supabase
      .from('ad_placements')
      .select('ad:ads(title), tv:tvs(last_heartbeat_at, venue:venues(name))')
      .eq('status', 'active')
      .in('tv_id', liveTvIds)
    type PRow = {
      ad: { title: string } | null
      tv: { last_heartbeat_at: string | null; venue: { name: string } | null } | null
    }
    playing = ((data ?? []) as unknown as PRow[])
      .filter((p) => isTvLive(p.tv?.last_heartbeat_at ?? null))
      .map((p) => ({ title: p.ad?.title ?? 'Ad', venue: p.tv?.venue?.name ?? '—' }))
  }

  const scopeLabel = t
    ? (territory.territories.find((x) => x.id === t)?.name ?? 'Territory')
    : 'All territories'

  return (
    <>
      <AutoRefresh seconds={60} />
      <PageHeader
        title="Today"
        description={
          inbox.counts.total === 0
            ? `${scopeLabel} · nothing waiting on you`
            : `${scopeLabel} · ${inbox.counts.total} thing${inbox.counts.total === 1 ? '' : 's'} need you`
        }
        action={
          <Link href="/admin/deals/new" className={buttonVariants()}>
            <Plus className="size-4" /> New deal
          </Link>
        }
      />

      <div className="space-y-6 p-5 md:p-6">
        {/* ---- The list. Everything that will not move unless you move it. ---- */}
        <Card>
          <CardContent className="p-0">
            {inbox.items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-10 text-center">
                <CheckCircle2 className="size-6 text-primary" />
                <p className="text-sm font-medium">Nothing is waiting on you.</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Every ad is reviewed, every screen is checking in, and every live account is
                  paid up. {inventory.totals.open > 0 && `There are ${inventory.totals.open} open spots to sell.`}
                </p>
                <Link href="/admin/sell" className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' mt-1'}>
                  Go sell
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {inbox.items.slice(0, 12).map((item, i) => {
                  const Icon = KIND_ICON[item.kind]
                  return (
                    <li key={i}>
                      <Link
                        href={item.href}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
                      >
                        <Icon className={`size-4 shrink-0 ${KIND_TONE[item.kind]}`} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{item.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
                        </div>
                        {item.at && (
                          <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                            {timeAgo(item.at)}
                          </span>
                        )}
                        <span className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-primary">
                          {item.cta}
                          <ChevronRight className="size-3.5" />
                        </span>
                      </Link>
                    </li>
                  )
                })}
                {inbox.items.length > 12 && (
                  <li className="px-4 py-2.5 text-xs text-muted-foreground">
                    +{inbox.items.length - 12} more
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ---- Where the year stands ---- */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="sm:col-span-2">
            <CardContent className="p-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-sm text-muted-foreground">Billed MRR</p>
                  <p className="mt-1 font-heading text-3xl font-bold tabular-nums">
                    {formatCents(mrrCents)}
                  </p>
                </div>
                <p className="text-right text-xs text-muted-foreground">
                  {goalPct}% of {formatCents(MRR_GOAL_CENTS)}
                  <br />
                  by {MRR_GOAL_LABEL}
                </p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${goalPct}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {formatCents(collectedCents)} collected this month
                {compedCents > 0 && ` · ${formatCents(compedCents)}/mo running comped`}
              </p>
            </CardContent>
          </Card>

          <StatTile
            label="Spots sold"
            value={`${inventory.totals.sold}/${inventory.totals.slots}`}
            sub={`${inventory.totals.pctSold}% of the network · ${formatCents(inventory.totals.openValueCents)}/mo open`}
            icon={DollarSign}
            href="/admin/sell"
          />
          <StatTile
            label="Screens live"
            value={`${inventory.totals.liveScreens}/${inventory.totals.screens}`}
            sub={`${inventory.totals.venues} location${inventory.totals.venues === 1 ? '' : 's'}`}
            icon={Tv}
            href="/admin/venues"
          />
        </div>

        {/* ---- On air right now ---- */}
        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <PlayCircle className="size-4 text-primary" />
              <h2 className="text-sm font-medium">On screens right now</h2>
              <span className="ml-auto text-xs text-muted-foreground">{playing.length} placements</span>
            </div>
            {playing.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing is airing. Either no screen is checking in, or no ad is placed yet.
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {playing.slice(0, 10).map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className="truncate">{p.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{p.venue}</span>
                  </li>
                ))}
                {playing.length > 10 && (
                  <li className="pt-1 text-xs text-muted-foreground">+{playing.length - 10} more</li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  href,
}: {
  label: string
  value: string
  sub: string
  icon: LucideIcon
  href: string
}) {
  return (
    <Link href={href} className="group">
      <Card className="h-full transition-colors group-hover:border-primary/50">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-muted-foreground">{label}</p>
            <Icon className="size-4 shrink-0 text-muted-foreground" />
          </div>
          <p className="mt-1 font-heading text-2xl font-bold tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
        </CardContent>
      </Card>
    </Link>
  )
}

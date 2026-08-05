import Link from 'next/link'
import {
  DollarSign,
  Inbox,
  Rocket,
  WifiOff,
  Palette,
  Plus,
  ChevronRight,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { buttonVariants } from '@/components/ui/button'
import { formatCents, timeAgo, isTvLive } from '@/lib/format'
import { AutoRefresh } from '@/components/app/AutoRefresh'
import { HudBody, StatStrip, Stat, Panel, Scroll } from '@/components/admin/hud'
import { Meter } from '@/components/admin/charts'
import { loadAdminInbox, loadBillingRows, type InboxKind } from '@/lib/adminInbox'
import { loadInventory } from '@/lib/inventory'
import { getSettings } from '@/lib/settings.server'
import { EditableValue } from '@/components/admin/EditableValue'

// Today — the cockpit.
//
// One screen, no scrolling to reach the second thing that matters: a band of
// numbers across the top, the work queue filling the left, and the two live
// readouts (money against the goal, what is on air) stacked on the right. The
// queue scrolls inside its own panel so the right rail never leaves the screen.

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

  const [inbox, inventory, billingRows, settings] = await Promise.all([
    loadAdminInbox(t),
    loadInventory(t),
    loadBillingRows(t),
    getSettings(),
  ])
  const goalCents = settings.mrr_goal_cents

  // Recurring value of everything that is actually billed. Comps are excluded on
  // purpose — a comped ad is running, but it is not revenue, and folding it into
  // MRR is how a network talks itself into thinking it hit a number it didn't.
  const mrrCents = billingRows
    .filter((r) => r.billing.method !== 'comp' && r.billing.method !== 'unbilled')
    .reduce((a, r) => a + r.monthlyCents, 0)
  const compedCents = billingRows
    .filter((r) => r.billing.method === 'comp')
    .reduce((a, r) => a + r.monthlyCents, 0)

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

  // Where the unsold money is, richest first. Same sort the Sell page uses.
  const bestCalls = inventory.rows
    .filter((r) => r.active && r.open > 0)
    .sort((a, b) => b.openValueCents - a.openValueCents || b.open - a.open)
    .slice(0, 8)

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
          <Link href="/admin/deals/new" className={buttonVariants({ size: 'sm' })}>
            <Plus className="size-4" /> New deal
          </Link>
        }
      />

      <HudBody>
        <StatStrip cols={6}>
          <Stat
            label="Needs you"
            value={String(inbox.counts.total)}
            sub={inbox.counts.billing > 0 ? `${inbox.counts.billing} about money` : 'all clear'}
            tone={inbox.counts.billing > 0 ? 'bad' : undefined}
            title="Everything in the queue below: unpaid accounts, ads awaiting review, dark screens."
          />
          <Stat
            label="Billed MRR"
            value={formatCents(mrrCents)}
            sub={`${Math.round((mrrCents / goalCents) * 100)}% of ${formatCents(goalCents)}`}
            href="/admin/money"
            title="Recurring value of accounts that actually pay. Comps are excluded."
          />
          <Stat
            label="Collected"
            value={formatCents(collectedCents)}
            sub="this month"
            href="/admin/money"
            title="Cash in the payments ledger since the 1st — Stripe plus checks you logged."
          />
          <Stat
            label="Spots sold"
            value={`${inventory.totals.sold}/${inventory.totals.slots}`}
            sub={`${formatCents(inventory.totals.openValueCents)}/mo still open`}
            href="/admin/sell"
          />
          <Stat
            label="Screens live"
            value={`${inventory.totals.liveScreens}/${inventory.totals.screens}`}
            sub={`${inventory.totals.venues} location${inventory.totals.venues === 1 ? '' : 's'}`}
            href="/admin/venues"
            tone={
              inventory.totals.screens > 0 && inventory.totals.liveScreens < inventory.totals.screens
                ? 'warn'
                : undefined
            }
          />
          <Stat
            label="On air"
            value={String(playing.length)}
            sub="placements playing now"
            title="Active placements on screens that have checked in recently."
          />
        </StatStrip>

        <div className="grid gap-3 lg:grid-cols-3">
          {/* ---- The list. Everything that will not move unless you move it. ---- */}
          <Panel
            title="Needs you"
            note={inbox.items.length > 0 ? `${inbox.items.length} open` : undefined}
            className="lg:col-span-2"
            bodyClassName="p-0"
          >
            {inbox.items.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
                <CheckCircle2 className="size-5 text-primary" />
                <p className="text-sm font-medium">Nothing is waiting on you.</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Every ad is reviewed, every screen is checking in, and every live account is paid
                  up.{' '}
                  {inventory.totals.open > 0 &&
                    `There are ${inventory.totals.open} open spots to sell.`}
                </p>
                <Link
                  href="/admin/sell"
                  className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' mt-1'}
                >
                  Go sell
                </Link>
              </div>
            ) : (
              <Scroll max="max-h-[28rem]">
                <ul className="divide-y divide-border">
                  {inbox.items.map((item, i) => {
                    const Icon = KIND_ICON[item.kind]
                    return (
                      <li key={i}>
                        <Link
                          href={item.href}
                          className="flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-accent/50"
                        >
                          <Icon className={`size-3.5 shrink-0 ${KIND_TONE[item.kind]}`} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium">{item.title}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {item.detail}
                            </p>
                          </div>
                          {item.at && (
                            <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:block">
                              {timeAgo(item.at)}
                            </span>
                          )}
                          <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-primary">
                            {item.cta}
                            <ChevronRight className="size-3" />
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </Scroll>
            )}
          </Panel>

          {/* ---- The two live readouts ---- */}
          <div className="grid gap-3 content-start">
            {/* The goal and its deadline are both editable right here — the two
                numbers most likely to move as the year does. */}
            <Panel
              title="Billed MRR vs goal"
              action={
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <EditableValue settingKey="mrr_goal_cents" value={goalCents} allowReset={false} />
                  by
                  <EditableValue
                    settingKey="mrr_goal_label"
                    value={settings.mrr_goal_label}
                    allowReset={false}
                  />
                </span>
              }
            >
              <Meter value={mrrCents} target={goalCents} label="Billed MRR" />
              <p className="mt-2 text-[11px] text-muted-foreground">
                {formatCents(collectedCents)} collected this month
                {compedCents > 0 && ` · ${formatCents(compedCents)}/mo running comped`}
              </p>
            </Panel>

            <Panel title="On screens right now" note={`${playing.length} placement${playing.length === 1 ? '' : 's'}`}>
              {playing.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nothing is airing. Either no screen is checking in, or no ad is placed yet.
                </p>
              ) : (
                <Scroll max="max-h-52">
                  <ul className="space-y-1 text-[13px]">
                    {playing.map((p, i) => (
                      <li key={i} className="flex items-center justify-between gap-3">
                        <span className="truncate">{p.title}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{p.venue}</span>
                      </li>
                    ))}
                  </ul>
                </Scroll>
              )}
            </Panel>
          </div>
        </div>

        {/* ---- What to do once the queue is empty ----
            Straight off the inventory already loaded above, so this panel costs
            no extra query. It is here because "nothing needs you" is not the
            same as "nothing to do" — the open spots are the whole business. */}
        {bestCalls.length > 0 && (
          <Panel
            title="Best calls today"
            note={`${formatCents(inventory.totals.openValueCents)}/mo unsold across the network`}
            action={
              <Link href="/admin/sell" className="text-[11px] text-primary hover:underline">
                All open inventory ›
              </Link>
            }
            bodyClassName="p-0"
          >
            <ul className="grid sm:grid-cols-2 lg:grid-cols-4">
              {bestCalls.map((r) => (
                <li key={r.venueId} className="border-b border-r border-border px-3 py-2 last:border-r-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link
                      href={`/admin/deals/new?venue=${r.venueId}`}
                      className="truncate text-[13px] font-medium hover:underline"
                    >
                      {r.name}
                    </Link>
                    <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums">
                      {formatCents(r.openValueCents)}
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {r.open} open at {formatCents(r.priceCents)}/mo
                    {r.contact.name || r.hostName ? ` · ${r.contact.name ?? r.hostName}` : ''}
                    {r.ownCategory ? ` · no ${r.ownCategory}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </HudBody>
    </>
  )
}

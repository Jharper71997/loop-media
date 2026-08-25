import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, SHIP_TABS } from '@/components/admin/SectionTabs'
import { EmptyState } from '@/components/admin/EmptyState'
import { HudBody, StatStrip, Stat } from '@/components/admin/hud'
import { formatCents, timeAgo } from '@/lib/format'
import {
  loadShipQueue,
  STEP_ORDER,
  STEP_LABEL,
  STEP_NOTE,
  STEP_IS_WORK,
  type ShipStep,
} from '@/lib/shipQueue'
import { cn } from '@/lib/utils'

// Ship — everything between a paying advertiser and their ad on a screen.
//
// The steps are ordered by how close to airing they are, and the page leads with
// the ones that are stuck. "Running" is at the bottom, collapsed, because it is
// the finish line: useful to confirm, never the thing you came here to do.

const STEP_TONE: Record<ShipStep, string> = {
  paid: 'bg-destructive',
  building: 'bg-warning',
  review: 'bg-primary',
  placing: 'bg-warning',
  live: 'bg-success',
}

export default async function ShipPage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const items = await loadShipQueue(territory.activeId)

  const groups = STEP_ORDER.map((step) => ({
    step,
    rows: items.filter((i) => i.step === step),
  })).filter((g) => g.rows.length > 0)

  const stuck = items.filter((i) => STEP_IS_WORK[i.step])
  const live = items.filter((i) => i.step === 'live')
  // Money that has been taken for an ad nobody can see yet. This is the number
  // the page exists for: it was never computed anywhere before, because no one
  // page knew both that they had paid and that nothing was airing.
  const stuckCents = stuck.reduce((s, i) => s + i.monthlyCents, 0)
  const liveCents = live.reduce((s, i) => s + i.monthlyCents, 0)

  return (
    <>
      <PageHeader
        title="Ship"
        description={
          stuck.length
            ? `${stuck.length} not on screen yet · ${live.length} running`
            : `All ${live.length} running`
        }
      />
      <SectionTabs tabs={SHIP_TABS} />

      <HudBody>
        <StatStrip cols={3}>
          <Stat
            label="Paid, not airing"
            value={formatCents(stuckCents)}
            sub={`${stuck.length} account${stuck.length === 1 ? '' : 's'} waiting on us`}
            tone={stuckCents > 0 ? 'bad' : 'good'}
            title="Monthly money already taken for advertisers whose ad is not on a screen."
          />
          <Stat
            label="Running"
            value={formatCents(liveCents)}
            sub={`${live.length} ad${live.length === 1 ? '' : 's'} on screen`}
            tone="good"
          />
          <Stat
            label="Waiting on you"
            value={String(items.filter((i) => i.step === 'review').length)}
            sub="submitted and blocked on review"
            href="/admin/queue"
          />
        </StatStrip>

        {groups.length === 0 ? (
          <EmptyState
            title="Nothing to ship."
            hint="No active campaign is missing an ad, waiting on review, or approved without a screen."
          />
        ) : (
          groups.map(({ step, rows }) => (
            <section key={step} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className={cn('size-1.5 shrink-0 rounded-full', STEP_TONE[step])} />
                <h2 className="text-[13px] font-medium">{STEP_LABEL[step]}</h2>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {rows.length}
                </span>
                <p className="min-w-0 truncate text-[11px] text-muted-foreground">
                  {STEP_NOTE[step]}
                </p>
              </div>

              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <ul className="divide-y divide-border">
                  {rows.map((i) => (
                    <li key={i.id}>
                      <Link
                        href={i.href}
                        className="flex items-center gap-3 px-3 py-3 hover:bg-muted/50 md:py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="truncate text-sm font-medium">{i.advertiserName}</span>
                            {i.since && (
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                {timeAgo(i.since)}
                              </span>
                            )}
                          </div>
                          <p className="line-clamp-2 text-xs text-muted-foreground md:truncate">
                            {i.title !== i.advertiserName ? `${i.title} · ` : ''}
                            {i.blocker}
                          </p>
                        </div>
                        {i.monthlyCents > 0 && (
                          <div className="shrink-0 text-right">
                            <div
                              className={cn(
                                'font-mono text-sm tabular-nums',
                                STEP_IS_WORK[i.step] ? 'text-destructive' : 'text-muted-foreground'
                              )}
                            >
                              {formatCents(i.monthlyCents)}
                            </div>
                            <div className="hidden text-[10px] text-muted-foreground sm:block">
                              {STEP_IS_WORK[i.step] ? 'paid, not airing' : '/mo running'}
                            </div>
                          </div>
                        )}
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ))
        )}
      </HudBody>
    </>
  )
}

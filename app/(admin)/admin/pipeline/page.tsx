import Link from 'next/link'
import { AlertTriangle, Upload, Trophy, XCircle, Send } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, ADVERTISER_TABS } from '@/components/admin/SectionTabs'
import { HudBody, StatStrip, Stat, Panel } from '@/components/admin/hud'
import { buttonVariants } from '@/components/ui/button'
import { formatCents } from '@/lib/format'
import { loadBoard } from '@/lib/opportunities'
import { stagesFor, KIND_LABEL, wonLabel, lostLabel, type OpportunityKind } from '@/lib/pipeline'
import { Board } from './Board'
import { NewOpportunityDialog } from './NewOpportunityDialog'
import { PipelineTabs } from './PipelineTabs'
import { cn } from '@/lib/utils'

// The pipeline board — the thing this admin was missing.
//
// Everything else in here answers "how is the network doing" or "what is broken".
// This answers "who do I call today, and what did I say last time", which is the
// question a two-person sales operation actually opens the laptop for.

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>
}) {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const { kind: kindParam } = await searchParams
  const kind: OpportunityKind = kindParam === 'host' ? 'host' : 'advertiser'

  const supabase = await createClient()
  const [board, { data: catData }] = await Promise.all([
    loadBoard(t, kind),
    supabase.from('categories').select('id, name').order('name'),
  ])
  const categories = (catData ?? []) as { id: string; name: string }[]
  const stages = stagesFor(kind)
  const { totals } = board

  const scope = t
    ? (territory.territories.find((x) => x.id === t)?.name ?? 'Territory')
    : 'All markets'

  return (
    <>
      <PageHeader
        title="Pipeline"
        description={
          board.ready
            ? `${scope} · ${totals.open} open · ${formatCents(totals.openValueCents)}/mo on the table`
            : 'Not set up yet'
        }
        action={
          <div className="flex items-center gap-2">
            <Link
              href={`/admin/pipeline/outreach?kind=${kind}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Send className="size-4" /> Outreach
            </Link>
            <Link
              href="/admin/pipeline/import"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Upload className="size-4" /> Import
            </Link>
            <NewOpportunityDialog kind={kind} categories={categories} />
          </div>
        }
      />

      {/* Board vs dashboard, and which pipeline. Two sales motions that feed
          each other: hosts create the inventory advertisers buy. */}
      <SectionTabs tabs={ADVERTISER_TABS} />
      <PipelineTabs kind={kind} />

      <HudBody>
        {!board.ready ? (
          <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            <AlertTriangle className="mt-px size-4 shrink-0 text-warning" />
            <div className="space-y-1">
              <p className="font-medium">The pipeline tables have not been created yet.</p>
              <p className="text-muted-foreground">
                Paste{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  loop-run-this-in-supabase.sql
                </code>{' '}
                (on your Desktop) into the Supabase SQL editor and reload. Nothing else in the admin
                is affected until you do — this page is the only thing waiting on it.
              </p>
            </div>
          </div>
        ) : (
          <>
            <StatStrip cols={5}>
              <Stat
                label="Open"
                value={String(totals.open)}
                sub={`in ${KIND_LABEL[kind].toLowerCase()}`}
              />
              <Stat
                label="On the table"
                value={`${formatCents(totals.openValueCents)}/mo`}
                sub="if every open deal closed"
                title="Sum of the monthly value of every open card in this pipeline."
              />
              <Stat
                label="Due today"
                value={String(totals.dueCount)}
                sub={totals.dueCount > 0 ? 'follow-ups waiting' : 'nothing owed'}
                tone={totals.dueCount > 0 ? 'warn' : undefined}
                href="/admin"
              />
              <Stat
                label={`${wonLabel(kind)} this month`}
                value={String(totals.wonThisMonth)}
                sub={
                  totals.wonThisMonthCents > 0
                    ? `${formatCents(totals.wonThisMonthCents)}/mo added`
                    : '—'
                }
                tone={totals.wonThisMonth > 0 ? 'good' : undefined}
              />
              <Stat
                label="Conversion"
                value={totals.conversionPct == null ? '—' : `${totals.conversionPct}%`}
                sub={
                  totals.conversionPct == null
                    ? 'nothing closed yet'
                    : `of everything closed · ${totals.lostThisMonth} ${lostLabel(kind).toLowerCase()} this month`
                }
                title="Won divided by everything ever closed in this pipeline. Open deals are not counted — they have not decided yet."
              />
            </StatStrip>

            {totals.open === 0 && board.won.length === 0 && board.lost.length === 0 ? (
              <Panel title={KIND_LABEL[kind]}>
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <p className="text-sm font-medium">Nothing in this pipeline yet.</p>
                  <p className="max-w-md text-xs text-muted-foreground">
                    {kind === 'advertiser'
                      ? 'Add the businesses you are working — the declined Brew Loop sponsors and the Surf City target list are the obvious first import.'
                      : 'Add the venues you want a screen in. Every host you land is inventory you can sell against.'}
                  </p>
                  <div className="mt-1 flex gap-2">
                    <Link
                      href="/admin/pipeline/import"
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      <Upload className="size-4" /> Paste a list
                    </Link>
                  </div>
                </div>
              </Panel>
            ) : (
              <Board
                kind={kind}
                columns={board.columns}
                stages={stages}
                categories={categories}
              />
            )}

            {(board.won.length > 0 || board.lost.length > 0) && (
              <div className="grid gap-3 lg:grid-cols-2">
                <Panel
                  title={`${wonLabel(kind)} recently`}
                  note={board.won.length ? `${board.won.length} shown` : undefined}
                  bodyClassName="p-0"
                >
                  <ClosedList
                    items={board.won}
                    empty={`Nothing ${wonLabel(kind).toLowerCase()} yet.`}
                    icon="won"
                  />
                </Panel>
                <Panel
                  title={`${lostLabel(kind)} recently`}
                  note="the objections worth answering"
                  bodyClassName="p-0"
                >
                  <ClosedList
                    items={board.lost}
                    empty={`Nothing ${lostLabel(kind).toLowerCase()} yet.`}
                    icon="lost"
                  />
                </Panel>
              </div>
            )}
          </>
        )}
      </HudBody>
    </>
  )
}

function ClosedList({
  items,
  empty,
  icon,
}: {
  items: { id: string; businessName: string; monthlyCents: number; lostReason: string | null }[]
  empty: string
  icon: 'won' | 'lost'
}) {
  if (items.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-muted-foreground">{empty}</p>
  }
  const Icon = icon === 'won' ? Trophy : XCircle
  return (
    <ul className="divide-y divide-border">
      {items.map((o) => (
        <li key={o.id} className="flex items-center gap-2 px-3 py-1.5">
          <Icon
            className={cn(
              'size-3 shrink-0',
              icon === 'won' ? 'text-success' : 'text-muted-foreground'
            )}
            aria-hidden
          />
          <Link
            href={`/admin/pipeline/${o.id}`}
            className="min-w-0 flex-1 truncate text-[13px] hover:underline"
          >
            {o.businessName}
          </Link>
          {o.lostReason && (
            <span className="hidden min-w-0 max-w-[16rem] truncate text-[11px] text-muted-foreground sm:block">
              {o.lostReason}
            </span>
          )}
          {o.monthlyCents > 0 && (
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
              {formatCents(o.monthlyCents)}/mo
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

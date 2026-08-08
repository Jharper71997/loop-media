import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, TODAY_TABS } from '@/components/admin/SectionTabs'
import { AutoRefresh } from '@/components/app/AutoRefresh'
import { HudBody, StatStrip, Stat } from '@/components/admin/hud'
import { CaseBoard } from '@/components/admin/CaseBoard'
import { loadCases } from '@/lib/cases'
import { loadBillingRows } from '@/lib/adminInbox'
import { formatCents } from '@/lib/format'

// Today — the whole business as a list of open problems.
//
// This page used to be a dashboard: a band of numbers, a work queue, a meter,
// a list of what was on air. All true, none of it pointed anywhere. You could
// read the entire page and still not know that a screen had been dark for four
// days and three advertisers were paying for it.
//
// Now the page IS the problem list. Every row has money on it and opens a case
// page that shows the evidence and the fix. The numbers on top are only there to
// say how much is at stake in each direction — they are not the point.

export default async function AdminToday() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId

  const [{ cases, totals }, billingRows] = await Promise.all([loadCases(t), loadBillingRows(t)])

  // Recurring value of everything actually billed. Comps are excluded on purpose:
  // a comped ad is running, but it is not revenue, and folding it into MRR is how
  // a network talks itself into thinking it hit a number it didn't.
  const mrrCents = billingRows
    .filter((r) => r.billing.method !== 'comp' && r.billing.method !== 'unbilled')
    .reduce((a, r) => a + r.monthlyCents, 0)

  const scopeLabel = t
    ? (territory.territories.find((x) => x.id === t)?.name ?? 'Territory')
    : 'All territories'

  const description = totals.open
    ? `${totals.open} open · ${totals.critical} breaking now · ${scopeLabel}`
    : `Nothing open · ${scopeLabel}`

  return (
    <>
      <AutoRefresh seconds={60} />
      <PageHeader title="Today" description={description} />
      <SectionTabs tabs={TODAY_TABS} />
      <HudBody>
        <StatStrip cols={4}>
          <Stat
            label="At risk"
            value={formatCents(totals.atRiskCents)}
            sub="per month, breaking or unpaid"
            tone={totals.atRiskCents > 0 ? 'bad' : undefined}
            title="Revenue on dark screens, on advertisers not getting delivery or results, and on accounts that owe us."
          />
          <Stat
            label="Given away"
            value={formatCents(totals.compedCents)}
            sub="per month, comped or unbilled"
            tone={totals.compedCents > 0 ? 'warn' : undefined}
            title="What the free and never-billed accounts would be worth at their current rate."
          />
          <Stat
            label="Unsold"
            value={formatCents(totals.unsoldCents)}
            sub="per month, open spots"
            href="/admin/sell"
            title="Monthly value of empty spots on screens that are already live and earning."
          />
          <Stat
            label="Billed MRR"
            value={formatCents(mrrCents)}
            sub="accounts that actually pay"
            href="/admin/money"
            title="Recurring value of billed accounts. Comps and unbilled accounts are excluded."
          />
        </StatStrip>

        <CaseBoard cases={cases} />
      </HudBody>
    </>
  )
}

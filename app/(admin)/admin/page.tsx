import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, WATCH_TABS } from '@/components/admin/SectionTabs'
import { AutoRefresh } from '@/components/app/AutoRefresh'
import { HudBody, StatStrip, Stat } from '@/components/admin/hud'
import { CaseBoard } from '@/components/admin/CaseBoard'
import { loadCases } from '@/lib/cases'
import { loadBillingRows } from '@/lib/adminInbox'
import { formatCents } from '@/lib/format'

// Watch — is anything dark, broken, or being short-changed right now.
//
// This page used to be a dashboard: a band of numbers, a work queue, a meter,
// a list of what was on air. All true, none of it pointed anywhere. You could
// read the entire page and still not know that a screen had been dark for four
// days and three advertisers were paying for it.
//
// Now the page IS the problem list. Every row has money on it and opens a case
// page that shows the evidence and the fix. The numbers on top are only there to
// say how much is at stake in each direction — they are not the point.
//
// Two things changed when it stopped being readable at 26 rows:
//
//   * ONE PROBLEM IS ONE ROW. A dark screen used to appear once as the screen
//     and again per advertiser on it; four outages made eleven rows. The screen
//     case now names the advertisers going without, and only a paying advertiser
//     receiving NOTHING gets a row of their own. See the collapse in lib/cases.ts.
//   * A ROW CAN BE CLEARED. Every case is derived, so handling one changed
//     nothing on screen — the list could only grow. Cases can now be snoozed,
//     and come back on their own if they get worse (lib/caseDismissals.ts).
//
// Open inventory left the board entirely. Every venue is mostly unsold, the
// number is four figures, and the list sorts by money — so "19 of 24 spots open"
// outranked a screen that had been dark for three days. Selling is a job with
// its own surface; the total stays here as a number, which is all it ever was.

export default async function AdminWatch() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId

  const [{ cases, snoozed, totals }, billingRows] = await Promise.all([
    loadCases(t),
    loadBillingRows(t),
  ])

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
    ? `${totals.open} open · ${totals.critical} breaking now${totals.snoozed ? ` · ${totals.snoozed} snoozed` : ''} · ${scopeLabel}`
    : totals.snoozed
      ? `Nothing open · ${totals.snoozed} snoozed · ${scopeLabel}`
      : `Nothing open · ${scopeLabel}`

  return (
    <>
      <AutoRefresh seconds={60} />
      <PageHeader title="Watch" description={description} />
      <SectionTabs tabs={WATCH_TABS} />
      <HudBody>
        <StatStrip cols={4}>
          <Stat
            label="At risk"
            value={formatCents(totals.atRiskCents)}
            sub="per month, breaking or unpaid"
            tone={totals.atRiskCents > 0 ? 'bad' : undefined}
            title="Revenue on dark screens and on accounts that owe us. Delivery is counted once, on the screen — never again per advertiser sitting on it."
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
            title="Monthly value of empty spots on screens that are already live and earning. Worked on the call list, not here."
          />
          <Stat
            label="Billed MRR"
            value={formatCents(mrrCents)}
            sub="accounts that actually pay"
            href="/admin/money"
            title="Recurring value of billed accounts. Comps and unbilled accounts are excluded."
          />
        </StatStrip>

        <CaseBoard cases={cases} snoozed={snoozed} />
      </HudBody>
    </>
  )
}

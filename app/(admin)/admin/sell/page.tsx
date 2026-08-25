import Link from 'next/link'
import { Plus } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, SELL_TABS } from '@/components/admin/SectionTabs'
import { buttonVariants } from '@/components/ui/button'
import { ExportCsvButton } from '@/components/admin/ExportCsvButton'
import { EmptyState } from '@/components/admin/EmptyState'
import { HudBody, StatStrip, Stat } from '@/components/admin/hud'
import { CallCard } from '@/components/admin/CallCard'
import { formatCents } from '@/lib/format'
import { loadCallList, REASON_LABEL, REASON_NOTE, type CallReason } from '@/lib/callList'
import { loadInventory } from '@/lib/inventory'
import { loadBillingRows } from '@/lib/adminInbox'
import { getSettings } from '@/lib/settings.server'
import { getPricingConfig } from '@/lib/pricing.server'

// Sell — the call list, in the order you should work it.
//
// This page used to be an inventory report: every active venue, sorted by open
// spots, with the contact details tucked into the last third of a row of eight
// facts. It answered "what is unsold", which is a number, not a job. It also
// only knew about venues — the follow-up you promised on a call yesterday lived
// in /admin/pipeline, and nothing put the two in one order.
//
// lib/callList.ts merges them and ranks them. This page renders that ranking in
// groups, promises first, with the phone number as a button rather than a fact.

const ORDER: CallReason[] = ['promised', 'going-cold', 'has-room', 'owed']

export default async function SellPage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId

  const [calls, inventory, billingRows, settings, pricing] = await Promise.all([
    loadCallList(t),
    loadInventory(t),
    loadBillingRows(t),
    getSettings(),
    getPricingConfig(),
  ])

  // "N more spots at $75" reads the live rate, so repricing on /admin/pricing
  // moves the number of calls this page says the goal is worth.
  const rateCents = pricing.tierPriceCents.standard
  const mrrCents = billingRows
    .filter((r) => r.billing.method !== 'comp' && r.billing.method !== 'unbilled')
    .reduce((a, r) => a + r.monthlyCents, 0)
  const goalCents = settings.mrr_goal_cents
  const gapCents = Math.max(0, goalCents - mrrCents)

  const owed = calls.filter((c) => c.reason === 'promised')
  const byReason = ORDER.map((r) => ({ reason: r, rows: calls.filter((c) => c.reason === r) })).filter(
    (g) => g.rows.length > 0
  )

  const csvRows = calls.map((c) => ({
    why: REASON_LABEL[c.reason],
    business: c.name,
    contact: c.contactName ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    detail: c.why,
    monthly_usd: (c.moneyCents / 100).toFixed(2),
  }))

  return (
    <>
      <PageHeader
        title="Sell"
        description={
          calls.length
            ? `${calls.length} call${calls.length === 1 ? '' : 's'} · ${owed.length} you promised`
            : 'Nobody to call'
        }
        action={
          <div className="flex items-center gap-2">
            <ExportCsvButton filename="loop-call-list.csv" rows={csvRows} />
            <Link href="/admin/deals/new" className={buttonVariants({ size: 'sm' })}>
              <Plus className="size-4" /> New deal
            </Link>
          </div>
        }
      />
      <SectionTabs tabs={SELL_TABS} />

      <HudBody>
        <StatStrip cols={4}>
          <Stat
            label="Calls to make"
            value={String(calls.length)}
            sub={owed.length ? `${owed.length} you already promised` : 'nothing promised'}
            tone={owed.length > 0 ? 'warn' : undefined}
          />
          <Stat
            label="Open inventory"
            value={`${formatCents(inventory.totals.openValueCents)}/mo`}
            sub={`${inventory.totals.open} spot${inventory.totals.open === 1 ? '' : 's'} at today's rate`}
          />
          <Stat
            label="Billed MRR"
            value={`${formatCents(mrrCents)}/mo`}
            sub="accounts that actually pay"
            href="/admin/money"
          />
          <Stat
            label={`Gap to ${formatCents(goalCents)}`}
            value={`${formatCents(gapCents)}/mo`}
            sub={
              gapCents === 0
                ? `Goal met — ${settings.mrr_goal_label}`
                : `${Math.ceil(gapCents / rateCents)} more spots at ${formatCents(rateCents)} · by ${settings.mrr_goal_label}`
            }
            tone={gapCents > 0 ? 'warn' : 'good'}
          />
        </StatStrip>

        {byReason.length === 0 ? (
          <EmptyState
            title="Nobody to call."
            hint="Every follow-up is scheduled, every live screen is sold, and no host is owed anything. Add a prospect on the pipeline to start a new one."
          />
        ) : (
          byReason.map(({ reason, rows }) => (
            <section key={reason} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h2 className="text-[13px] font-medium">{REASON_LABEL[reason]}</h2>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {rows.length}
                </span>
                <p className="min-w-0 truncate text-[11px] text-muted-foreground">
                  {REASON_NOTE[reason]}
                </p>
              </div>
              {/* One column on a phone, two once there is room — a call card is
                  useless below about 300px and wasteful above about 600. */}
              <div className="grid gap-2 lg:grid-cols-2">
                {rows.map((c) => (
                  <CallCard key={c.id} c={c} />
                ))}
              </div>
            </section>
          ))
        )}
      </HudBody>
    </>
  )
}

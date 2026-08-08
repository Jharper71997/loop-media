import Link from 'next/link'
import { loadVerdict } from '@/lib/verdict'
import { loadActivity } from '@/lib/activity'
import { loadBillingRows } from '@/lib/adminInbox'
import { loadHostBenefits } from '@/lib/hostBenefit'
import { HEALTH_VARIANT, BILLING_METHOD_LABEL } from '@/lib/billing'
import { Badge } from '@/components/ui/badge'
import { RecordVerdict, ActivityTimeline, RailPanel, RailFact } from '@/components/admin/RecordShell'
import { formatCents } from '@/lib/format'

// The slow parts of a record page, split out so they can stream.
//
// Everything in this file has one thing in common: it is derived from a
// NETWORK-WIDE rollup — every live campaign's billing, every host's benefit,
// the whole case board — filtered down to one advertiser at the very end. That
// is what makes a record page and Today incapable of disagreeing, and it is also
// why none of it belongs in front of the first paint. Opening one account used
// to compute the entire business first: the page sat blank while it priced every
// campaign in the network.
//
// Rendered inside <Suspense>, the identity, tabs, campaigns and contact facts
// paint from their own cheap queries immediately, and the analysis arrives a
// moment later — the right order, because you already know which account you
// clicked. The loaders are React-cached, so the four components below share one
// set of round trips no matter how many boundaries they sit behind.

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export async function VerdictBlock({
  advertiserId,
  territoryId,
  monthlyCents,
  liveCampaigns,
}: {
  advertiserId: string
  territoryId: string | null
  monthlyCents: number
  liveCampaigns: number
}) {
  // The healthy line needs the billing summary, so it is built here rather than
  // on the page — otherwise the page would have to await the billing rollup just
  // to hand this component a sentence it only shows when there is nothing wrong.
  const [verdict, billing] = await Promise.all([
    loadVerdict({ kind: 'advertiser', id: advertiserId }, territoryId),
    loadBillingRows(territoryId),
  ])
  const worst = worstFor(billing, advertiserId)
  const healthyLine = worst
    ? `Nothing open. ${worst.billing.summary}, ${formatCents(monthlyCents)}/mo across ${liveCampaigns} live campaign${liveCampaigns === 1 ? '' : 's'}.`
    : 'Nothing open, and no live campaign either — this account has never been on a screen.'

  return (
    <RecordVerdict
      cases={verdict.cases}
      moneyCents={verdict.moneyCents}
      healthyLine={healthyLine}
    />
  )
}

export function VerdictSkeleton() {
  return <div className="h-14 animate-pulse rounded-lg border border-border bg-muted/40" />
}

// ---------------------------------------------------------------------------
// Header badges
// ---------------------------------------------------------------------------

const HEALTH_ORDER = { unbilled: 0, overdue: 1, due: 2, ok: 3 } as const

function worstFor(rows: Awaited<ReturnType<typeof loadBillingRows>>, advertiserId: string) {
  // An advertiser can hold more than one campaign. Lead with the worst, because
  // that is the one that needs doing something about.
  return rows
    .filter((b) => b.advertiserId === advertiserId)
    .sort((a, b) => HEALTH_ORDER[a.billing.health] - HEALTH_ORDER[b.billing.health])[0]
}

export async function StatusBadges({
  advertiserId,
  territoryId,
}: {
  advertiserId: string
  territoryId: string | null
}) {
  const [billing, benefits] = await Promise.all([
    loadBillingRows(territoryId),
    loadHostBenefits(territoryId),
  ])
  const worst = worstFor(billing, advertiserId)
  const isHost = benefits.some((b) => b.hostId === advertiserId)
  return (
    <>
      {isHost && <Badge variant="outline">Host</Badge>}
      {worst && (
        <Badge variant={HEALTH_VARIANT[worst.billing.health]}>{worst.billing.summary}</Badge>
      )}
    </>
  )
}

export function BadgesSkeleton() {
  return <span className="inline-block h-5 w-24 animate-pulse rounded-full bg-muted/60" />
}

// ---------------------------------------------------------------------------
// Rail panels that depend on the network rollups
// ---------------------------------------------------------------------------

export async function MoneyAndHostPanels({
  advertiserId,
  territoryId,
  monthlyCents,
}: {
  advertiserId: string
  territoryId: string | null
  monthlyCents: number
}) {
  const [billing, benefits] = await Promise.all([
    loadBillingRows(territoryId),
    loadHostBenefits(territoryId),
  ])
  const worst = worstFor(billing, advertiserId)
  const hostBenefit = benefits.find((b) => b.hostId === advertiserId)

  return (
    <>
      <RailPanel title="Money">
        <RailFact label="Monthly" value={formatCents(monthlyCents)} />
        <RailFact label="Billing" value={worst?.billing.summary ?? 'No live campaign'} />
        <RailFact
          label="Method"
          value={worst ? BILLING_METHOD_LABEL[worst.billing.method] : null}
        />
        {worst && (
          <div className="mt-2">
            <Link
              href={`/admin/money?campaign=${worst.campaignId}`}
              className="text-xs text-primary hover:underline"
            >
              Open in billing →
            </Link>
          </div>
        )}
      </RailPanel>

      {hostBenefit && (
        <RailPanel title="Host benefit">
          <RailFact label="Screens hosted" value={hostBenefit.hostedTvs} />
          <RailFact label="Free screens earned" value={hostBenefit.owed} />
          <RailFact label="Using" value={hostBenefit.using} />
          <RailFact label="Code" value={hostBenefit.compCode} />
          <p className="mt-2 text-xs text-muted-foreground">{hostBenefit.venueNames.join(', ')}</p>
        </RailPanel>
      )}
    </>
  )
}

export function RailSkeleton() {
  return <div className="h-28 animate-pulse rounded-lg border border-border bg-muted/40" />
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export async function ActivityBlock({
  advertiserId,
  limit,
}: {
  advertiserId: string
  limit?: number
}) {
  const events = await loadActivity({ kind: 'advertiser', id: advertiserId })
  return <ActivityTimeline events={limit ? events.slice(0, limit) : events} />
}

export function ActivitySkeleton() {
  return (
    <div className="space-y-px overflow-hidden rounded-lg border border-border">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-11 animate-pulse bg-muted/40" />
      ))}
    </div>
  )
}

import { loadVerdict } from '@/lib/verdict'
import { loadActivity } from '@/lib/activity'
import { RecordVerdict, ActivityTimeline } from '@/components/admin/RecordShell'

// The two slow parts of a record page, split out so they can stream.
//
// The verdict is correct because it comes from loadCases — the same array the
// board reads, so a record and Today can never disagree — but that means
// opening one advertiser computed the ENTIRE board first: every campaign's
// billing, the inventory rollup, the play counts, host benefits, the lot. The
// page sat blank until all of it finished.
//
// Rendering them inside <Suspense> means the identity, tabs, rail and campaign
// list paint from their own queries immediately, and these fill in behind. The
// click feels instant; the analysis arrives a moment later, which is the right
// order — you already know which account you opened.

export async function VerdictBlock({
  advertiserId,
  territoryId,
  healthyLine,
}: {
  advertiserId: string
  territoryId: string | null
  healthyLine: string
}) {
  const verdict = await loadVerdict({ kind: 'advertiser', id: advertiserId }, territoryId)
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

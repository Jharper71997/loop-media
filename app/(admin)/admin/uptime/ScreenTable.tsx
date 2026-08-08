'use client'

import { Badge } from '@/components/ui/badge'
import { DataTable, type Column, type SavedView } from '@/components/admin/DataTable'
import { LiveStatus } from '@/components/app/LiveStatus'
import { formatCents, timeAgo } from '@/lib/format'

// Every paired screen, as a list you can actually interrogate.
//
// It was a fixed worst-uptime-first table with no controls, which answers one
// question and refuses every other one. The two orders that matter day to day —
// "what has been dark longest" (sort by last seen, ascending) and "what is
// costing me the most while broken" — were both unreachable.

export type ScreenRow = {
  tvId: string
  venueId: string
  venueName: string
  pct: number
  breach: boolean
  hasData: boolean
  down: boolean
  lastHeartbeat: string | null
  /** Revenue riding on this screen, split across the screens each campaign runs on. */
  atRiskCents: number
  adsHere: number
}

const VIEWS: SavedView<ScreenRow>[] = [
  { id: 'all', label: 'All screens', match: () => true },
  { id: 'down', label: 'Down now', match: (r) => r.down, tone: 'bad' },
  { id: 'breach', label: 'Below SLA', match: (r) => r.breach, tone: 'warn' },
  { id: 'never', label: 'Never checked in', match: (r) => !r.lastHeartbeat, tone: 'warn' },
]

const COLUMNS: Column<ScreenRow>[] = [
  {
    key: 'venue',
    header: 'Venue',
    value: (r) => r.venueName.toLowerCase(),
    cell: (r) => (
      <div className="min-w-0">
        <div className="truncate font-medium">{r.venueName}</div>
        <div className="text-xs text-muted-foreground">
          {r.adsHere} ad{r.adsHere === 1 ? '' : 's'} placed here
        </div>
      </div>
    ),
  },
  {
    key: 'lastSeen',
    header: 'Last seen',
    // Ascending on this is "dark longest first", which is the whole reason the
    // column exists. Nulls sink, so a screen that has never checked in does not
    // masquerade as the most urgent outage.
    value: (r) => r.lastHeartbeat,
    cell: (r) => (
      <span className={r.down ? 'text-destructive' : 'text-muted-foreground'}>
        {timeAgo(r.lastHeartbeat)}
      </span>
    ),
  },
  {
    key: 'now',
    header: 'Now',
    cell: (r) => <LiveStatus lastHeartbeat={r.lastHeartbeat} paired />,
  },
  {
    key: 'uptime',
    header: 'Uptime 30d',
    numeric: true,
    value: (r) => (r.hasData ? r.pct : null),
    cell: (r) =>
      r.hasData ? (
        <span className={r.breach ? 'font-semibold text-warning' : ''}>
          {Math.round(r.pct * 100)}%
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: 'sla',
    header: 'SLA',
    hideBelow: 'sm',
    value: (r) => (r.breach ? 0 : 1),
    cell: (r) =>
      r.breach ? (
        <Badge variant="destructive">Below</Badge>
      ) : r.hasData ? (
        <Badge variant="secondary">Meeting</Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: 'risk',
    header: 'At risk',
    numeric: true,
    hideBelow: 'md',
    value: (r) => r.atRiskCents,
    cell: (r) =>
      r.atRiskCents ? (
        <span className={r.down ? 'text-destructive' : ''}>{formatCents(r.atRiskCents)}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
]

export function ScreenTable({ rows }: { rows: ScreenRow[] }) {
  return (
    <DataTable
      rows={rows}
      rowId={(r) => r.tvId}
      columns={COLUMNS}
      views={VIEWS}
      href={(r) => `/admin/tvs/${r.tvId}`}
      defaultSort={{ key: 'uptime', dir: 'asc' }}
      searchable={(r) => r.venueName}
      searchPlaceholder="Search screens by venue…"
      emptyTitle="No paired screens yet"
      emptyHint="A screen appears here once it has been paired and starts checking in."
      csvFilename="loop-screen-uptime.csv"
      csvRow={(r) => ({
        venue: r.venueName,
        uptime_30d_pct: r.hasData ? Math.round(r.pct * 100) : '',
        below_sla: r.breach ? 'yes' : 'no',
        down_now: r.down ? 'yes' : 'no',
        last_seen: r.lastHeartbeat ?? 'never',
        at_risk_usd: (r.atRiskCents / 100).toFixed(2),
      })}
    />
  )
}

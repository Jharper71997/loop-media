'use client'

import { Badge } from '@/components/ui/badge'
import { DataTable, type Column, type SavedView } from '@/components/admin/DataTable'
import { formatCents, formatNumber, timeAgo } from '@/lib/format'
import { HEALTH_VARIANT, BILLING_METHOD_LABEL, type BillingHealth, type BillingMethod } from '@/lib/billing'
import { bulkDeactivateAdvertisers, bulkReactivateAdvertisers } from './bulk-actions'

// The advertiser roster, as a roster.
//
// It used to be a name, an email, a strip of creative thumbnails and a joined
// date — rendered twice, once as mobile cards and once as a desktop table — with
// no sort, and a status filter whose three options were about ads rather than
// about the account. You could not answer "who pays us", "who is running free",
// or "who is about to lapse" from this page at all; that lived on Money, keyed by
// campaign, and nothing linked the two.
//
// Every column here is a question worth asking about an account, and the five
// views are the five answers worth having on one click.

export type AdvertiserRow = {
  id: string
  name: string
  email: string
  phone: string | null
  joinedAt: string
  ads: number
  pendingAds: number
  liveAds: number
  screens: number
  /** MEASURED plays over the last 30 days, across everything they run. */
  plays: number
  scans: number
  monthlyCents: number
  method: BillingMethod | null
  health: BillingHealth | null
  billingSummary: string | null
  openCases: number
  deactivated: boolean
}

const isFree = (r: AdvertiserRow) => r.method === 'comp' || r.method === 'unbilled'

const VIEWS: SavedView<AdvertiserRow>[] = [
  { id: 'all', label: 'All', match: (r) => !r.deactivated },
  { id: 'paying', label: 'Paying', match: (r) => !r.deactivated && !!r.method && !isFree(r) },
  { id: 'comped', label: 'Comped', match: (r) => !r.deactivated && r.method === 'comp' },
  { id: 'unbilled', label: 'Never billed', match: (r) => !r.deactivated && r.method === 'unbilled', tone: 'warn' },
  {
    id: 'at-risk',
    label: 'At risk',
    match: (r) => !r.deactivated && (r.openCases > 0 || r.health === 'overdue' || r.health === 'unbilled'),
    tone: 'bad',
  },
  { id: 'deactivated', label: 'Deactivated', match: (r) => r.deactivated },
]

const COLUMNS: Column<AdvertiserRow>[] = [
  {
    key: 'name',
    header: 'Business',
    value: (r) => r.name.toLowerCase(),
    cell: (r) => (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{r.name}</span>
          {r.deactivated && (
            <Badge variant="outline" className="shrink-0">
              On hold
            </Badge>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">{r.email}</div>
      </div>
    ),
  },
  {
    key: 'billing',
    header: 'Billing',
    value: (r) => r.billingSummary ?? 'zzz',
    cell: (r) =>
      r.health ? (
        <div className="flex flex-col items-start gap-0.5">
          <Badge variant={HEALTH_VARIANT[r.health]}>{r.billingSummary}</Badge>
          <span className="text-[10px] text-muted-foreground">
            {r.method ? BILLING_METHOD_LABEL[r.method] : ''}
          </span>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">No live campaign</span>
      ),
  },
  {
    key: 'monthly',
    header: 'Monthly',
    numeric: true,
    value: (r) => r.monthlyCents,
    cell: (r) =>
      r.monthlyCents ? (
        <span className={isFree(r) ? 'text-muted-foreground' : ''}>
          {formatCents(r.monthlyCents)}
          {isFree(r) && <span className="ml-1 text-[10px]">free</span>}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: 'screens',
    header: 'Screens',
    numeric: true,
    hideBelow: 'sm',
    value: (r) => r.screens,
    cell: (r) => (r.screens ? r.screens : <span className="text-muted-foreground">—</span>),
  },
  {
    key: 'plays',
    header: 'Shown 30d',
    numeric: true,
    hideBelow: 'md',
    value: (r) => r.plays,
    cell: (r) => (r.plays ? formatNumber(r.plays) : <span className="text-muted-foreground">—</span>),
  },
  {
    key: 'scans',
    header: 'Scans 30d',
    numeric: true,
    hideBelow: 'md',
    value: (r) => r.scans,
    cell: (r) => (r.scans ? formatNumber(r.scans) : <span className="text-muted-foreground">0</span>),
  },
  {
    key: 'ads',
    header: 'Ads',
    numeric: true,
    hideBelow: 'lg',
    value: (r) => r.ads,
    cell: (r) => (
      <span>
        {r.ads}
        {r.pendingAds > 0 && <span className="ml-1 text-warning">·{r.pendingAds} waiting</span>}
      </span>
    ),
  },
  {
    key: 'cases',
    header: 'Problems',
    numeric: true,
    value: (r) => r.openCases,
    cell: (r) =>
      r.openCases ? (
        <span className="font-medium text-destructive">{r.openCases}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: 'joined',
    header: 'Joined',
    hideBelow: 'lg',
    value: (r) => r.joinedAt,
    cell: (r) => <span className="text-xs text-muted-foreground">{timeAgo(r.joinedAt)}</span>,
  },
]

export function AdvertiserTable({ rows }: { rows: AdvertiserRow[] }) {
  return (
    <DataTable
      rows={rows}
      rowId={(r) => r.id}
      columns={COLUMNS}
      views={VIEWS}
      href={(r) => `/admin/advertisers/${r.id}`}
      defaultSort={{ key: 'monthly', dir: 'desc' }}
      searchable={(r) => `${r.name} ${r.email} ${r.phone ?? ''}`}
      searchPlaceholder="Search by business, email or phone…"
      emptyTitle="No advertisers yet"
      emptyHint="They appear here as soon as an account is created, whether or not it is paying."
      csvFilename="loop-advertisers.csv"
      csvRow={(r) => ({
        business: r.name,
        email: r.email,
        phone: r.phone ?? '',
        monthly_usd: (r.monthlyCents / 100).toFixed(2),
        billing: r.billingSummary ?? '',
        method: r.method ?? '',
        screens: r.screens,
        plays_30d: r.plays,
        scans_30d: r.scans,
        open_problems: r.openCases,
        joined: r.joinedAt.slice(0, 10),
      })}
      bulkActions={[
        {
          label: 'Put on hold',
          destructive: true,
          confirm: (n) =>
            `Put ${n} account${n === 1 ? '' : 's'} on hold? Their ads come off screens until you reactivate them.`,
          run: bulkDeactivateAdvertisers,
        },
        { label: 'Reactivate', run: bulkReactivateAdvertisers },
      ]}
    />
  )
}

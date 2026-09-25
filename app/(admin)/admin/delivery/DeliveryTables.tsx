'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { DataTable, type Column, type SavedView } from '@/components/admin/DataTable'
import { formatCents, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AdvertiserDelivery, LocationDelivery, Spot } from '@/lib/delivery'

// The two sides of lib/delivery.ts. The "where" column is the point of the page:
// every screen an ad is on, with what it did there, without opening a screen.

function SpotChips({ spots, label }: { spots: Spot[]; label: (s: Spot) => string }) {
  return (
    <div className="flex flex-wrap gap-1">
      {spots.map((s) => (
        <Link
          key={`${s.adId}:${s.tvId}`}
          href={`/admin/tvs/${s.tvId}`}
          title={`${s.adTitle} on ${s.screenLabel}${s.dark ? ' · screen is dark' : ''}${s.canceled ? ' · campaign canceled' : ''}`}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors hover:bg-accent/60',
            s.dark ? 'border-destructive/50' : 'border-border'
          )}
        >
          <span
            className={cn('size-1.5 shrink-0 rounded-full', s.dark ? 'bg-destructive' : 'bg-success')}
            aria-hidden
          />
          <span className="max-w-40 truncate">{label(s)}</span>
          <span className="font-mono tabular-nums text-muted-foreground">{formatNumber(s.plays)}</span>
          {s.scans > 0 && (
            <span className="font-mono tabular-nums text-primary">{s.scans} scan{s.scans === 1 ? '' : 's'}</span>
          )}
        </Link>
      ))}
    </div>
  )
}

const dash = <span className="text-muted-foreground">—</span>

// ---------------------------------------------------------------------------
// By advertiser
// ---------------------------------------------------------------------------

const ADVERTISER_VIEWS: SavedView<AdvertiserDelivery>[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'paying', label: 'Paying', match: (r) => !r.free },
  { id: 'free', label: 'Comped / unbilled', match: (r) => r.free && !r.noAccount && r.method !== 'host' },
  { id: 'host', label: 'Host perk', match: (r) => r.method === 'host' },
  { id: 'no-account', label: 'No account', match: (r) => r.noAccount, tone: 'warn' },
  { id: 'dark', label: 'On a dark screen', match: (r) => r.darkScreens > 0, tone: 'bad' },
  { id: 'canceled', label: 'Canceled, still airing', match: (r) => r.canceled, tone: 'bad' },
]

const ADVERTISER_COLUMNS: Column<AdvertiserDelivery>[] = [
  {
    key: 'name',
    header: 'Advertiser',
    value: (r) => r.name.toLowerCase(),
    className: 'md:min-w-40',
    cell: (r) => (
      <div className="min-w-0">
        <div className="truncate font-medium">{r.name}</div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {r.noAccount && <Badge variant="warning">No account</Badge>}
          {r.method === 'host' && <Badge variant="secondary">Host perk</Badge>}
          {r.canceled && <Badge variant="destructive">Canceled, still airing</Badge>}
          {r.ads > 1 && <span className="text-[10px] text-muted-foreground">{r.ads} ads</span>}
        </div>
        {/* On a phone the where-column would be clipped, so it moves under the name. */}
        <div className="mt-1.5 md:hidden">
          <SpotChips spots={r.spots} label={(s) => s.screenLabel} />
        </div>
      </div>
    ),
  },
  {
    key: 'where',
    header: 'Where it runs',
    hideBelow: 'md',
    className: 'min-w-64',
    cell: (r) => <SpotChips spots={r.spots} label={(s) => s.screenLabel} />,
  },
  {
    key: 'locations',
    header: 'Locations',
    numeric: true,
    value: (r) => r.locations,
    cell: (r) => (
      <span>
        {r.locations}
        {r.darkScreens > 0 && <span className="ml-1 text-destructive">·{r.darkScreens} dark</span>}
      </span>
    ),
  },
  {
    key: 'plays',
    header: 'Shown 30d',
    numeric: true,
    hideBelow: 'sm',
    value: (r) => r.plays,
    cell: (r) => (r.plays ? formatNumber(r.plays) : dash),
  },
  {
    key: 'scans',
    header: 'Scans 30d',
    numeric: true,
    hideBelow: 'md',
    value: (r) => r.scans,
    cell: (r) => formatNumber(r.scans),
  },
  {
    key: 'monthly',
    header: 'Monthly',
    numeric: true,
    hideBelow: 'md',
    value: (r) => r.monthlyCents,
    cell: (r) =>
      r.monthlyCents ? (
        <span className={r.free ? 'text-muted-foreground' : ''}>
          {formatCents(r.monthlyCents)}
          {r.free && <span className="ml-1 text-[10px]">free</span>}
        </span>
      ) : (
        dash
      ),
  },
]

export function ByAdvertiserTable({ rows }: { rows: AdvertiserDelivery[] }) {
  return (
    <DataTable
      rows={rows}
      rowId={(r) => r.advertiserId}
      columns={ADVERTISER_COLUMNS}
      views={ADVERTISER_VIEWS}
      href={(r) => r.href ?? `/admin/tvs/${r.spots[0].tvId}`}
      defaultSort={{ key: 'plays', dir: 'desc' }}
      searchable={(r) => `${r.name} ${r.spots.map((s) => `${s.screenLabel} ${s.adTitle}`).join(' ')}`}
      searchPlaceholder="Search an advertiser, ad or location…"
      emptyTitle="Nothing on air"
      emptyHint="Ads show up here as soon as they are placed on a screen and approved."
      csvFilename="loop-where-ads-run.csv"
      csvRow={(r) => ({
        advertiser: r.name,
        account: r.noAccount ? 'none' : 'yes',
        locations: r.locations,
        dark_screens: r.darkScreens,
        plays_30d: r.plays,
        scans_30d: r.scans,
        monthly_usd: (r.monthlyCents / 100).toFixed(2),
        where: r.spots.map((s) => `${s.screenLabel} (${s.plays})`).join('; '),
      })}
    />
  )
}

// ---------------------------------------------------------------------------
// By location
// ---------------------------------------------------------------------------

const LOCATION_VIEWS: SavedView<LocationDelivery>[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'dark', label: 'Dark now', match: (r) => r.darkScreens > 0, tone: 'bad' },
  { id: 'room', label: 'Has open slots', match: (r) => r.slotsTotal > r.slotsUsed },
]

const LOCATION_COLUMNS: Column<LocationDelivery>[] = [
  {
    key: 'name',
    header: 'Location',
    value: (r) => r.name.toLowerCase(),
    className: 'md:min-w-36',
    cell: (r) => (
      <div className="min-w-0">
        <div className="truncate font-medium">{r.name}</div>
        <div className="text-[10px] text-muted-foreground">
          {r.screens} screen{r.screens === 1 ? '' : 's'}
          {r.darkScreens > 0 && <span className="ml-1 text-destructive">· {r.darkScreens} dark</span>}
        </div>
        <div className="mt-1.5 md:hidden">
          <SpotChips spots={r.spots} label={(s) => s.advertiserName} />
        </div>
      </div>
    ),
  },
  {
    key: 'running',
    header: 'Running here',
    hideBelow: 'md',
    className: 'min-w-64',
    cell: (r) => <SpotChips spots={r.spots} label={(s) => s.advertiserName} />,
  },
  {
    key: 'slots',
    header: 'Slots used',
    numeric: true,
    value: (r) => r.slotsUsed,
    cell: (r) => (
      <span>
        {r.slotsUsed}
        {r.slotsTotal > 0 && <span className="text-muted-foreground">/{r.slotsTotal}</span>}
      </span>
    ),
  },
  {
    key: 'plays',
    header: 'Shown 30d',
    numeric: true,
    hideBelow: 'sm',
    value: (r) => r.plays,
    cell: (r) => (r.plays ? formatNumber(r.plays) : dash),
  },
  {
    key: 'scans',
    header: 'Scans 30d',
    numeric: true,
    hideBelow: 'md',
    value: (r) => r.scans,
    cell: (r) => formatNumber(r.scans),
  },
]

export function ByLocationTable({ rows }: { rows: LocationDelivery[] }) {
  return (
    <DataTable
      rows={rows}
      rowId={(r) => r.venueId}
      columns={LOCATION_COLUMNS}
      views={LOCATION_VIEWS}
      href={(r) => `/admin/venues/${r.venueId}`}
      defaultSort={{ key: 'plays', dir: 'desc' }}
      searchable={(r) => `${r.name} ${r.spots.map((s) => `${s.advertiserName} ${s.adTitle}`).join(' ')}`}
      searchPlaceholder="Search a location or advertiser…"
      emptyTitle="No screens carrying ads"
      emptyHint="A location appears once an approved ad is placed on one of its screens."
      csvFilename="loop-ads-by-location.csv"
      csvRow={(r) => ({
        location: r.name,
        screens: r.screens,
        dark_screens: r.darkScreens,
        slots_used: r.slotsUsed,
        slots_total: r.slotsTotal,
        plays_30d: r.plays,
        scans_30d: r.scans,
        running: r.spots.map((s) => `${s.advertiserName} (${s.plays})`).join('; '),
      })}
    />
  )
}

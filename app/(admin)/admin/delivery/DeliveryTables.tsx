'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { DataTable, type Column, type SavedView } from '@/components/admin/DataTable'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AdvertiserDelivery, LocationDelivery, ScreenOption, Spot } from '@/lib/delivery'
import { AddToScreen, RemoveSpot } from './PlacementEdit'

// The two sides of lib/delivery.ts, kept deliberately plain: who, which screens,
// how often it showed, how many scanned. Each screen chip has an ✕ to take the ad
// off; "Add to a screen" puts it on another. Per-screen play counts live in the
// chip's tooltip and on the screen page; billing lives on Advertisers.
//
// No row link on either table: the rows are where you edit placements, and a
// row-wide link would swallow the ✕ and Add buttons. The name links instead.

function ScreenChips({ spots, label }: { spots: Spot[]; label: (s: Spot) => string }) {
  return (
    <div className="flex flex-wrap gap-1">
      {spots.map((s) => (
        <span
          key={s.placementId}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-1.5 text-xs',
            s.dark ? 'border-destructive/60 text-destructive' : 'border-border'
          )}
        >
          <Link
            href={`/admin/tvs/${s.tvId}`}
            title={`${s.adTitle} on ${s.screenLabel}: ${s.plays == null ? 'count unavailable' : `shown ${formatNumber(s.plays)} times in 30 days`}${s.dark ? ' · screen is off right now' : ''}`}
            className="max-w-44 truncate hover:underline"
          >
            {label(s)}
            {s.dark && ' (off)'}
          </Link>
          <RemoveSpot spot={s} />
        </span>
      ))}
    </div>
  )
}

const shown = (n: number | null) =>
  n == null ? (
    <span className="text-muted-foreground" title="Still counting. Refresh in a minute.">
      …
    </span>
  ) : n ? (
    formatNumber(n)
  ) : (
    <span className="text-muted-foreground">0</span>
  )

// ---------------------------------------------------------------------------
// By advertiser
// ---------------------------------------------------------------------------

const ADVERTISER_VIEWS: SavedView<AdvertiserDelivery>[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'dark', label: 'On a screen that is off', match: (r) => r.darkScreens > 0, tone: 'bad' },
  { id: 'no-account', label: 'No account', match: (r) => r.noAccount, tone: 'warn' },
]

function Where({ r, screens }: { r: AdvertiserDelivery; screens: ScreenOption[] }) {
  const ads = [...new Map(r.spots.map((s) => [s.adId, s.adTitle])).entries()]
  const many = ads.length > 1
  return (
    <div className="space-y-1.5">
      <ScreenChips spots={r.spots} label={(s) => (many ? `${s.screenLabel} · ${s.adTitle}` : s.screenLabel)} />
      <div className="flex flex-wrap gap-1.5">
        {ads.map(([adId, title]) => (
          <AddToScreen
            key={adId}
            adId={adId}
            adTitle={title}
            label={many ? title : undefined}
            onScreens={r.spots.filter((s) => s.adId === adId).map((s) => s.tvId)}
            screens={screens}
          />
        ))}
      </div>
    </div>
  )
}

const advertiserColumns = (screens: ScreenOption[]): Column<AdvertiserDelivery>[] => [
  {
    key: 'name',
    header: 'Advertiser',
    value: (r) => r.name.toLowerCase(),
    className: 'md:w-48',
    cell: (r) => (
      <div className="min-w-0">
        {r.href ? (
          <Link href={r.href} className="block truncate font-medium hover:underline">
            {r.name}
          </Link>
        ) : (
          <div className="truncate font-medium">{r.name}</div>
        )}
        {(r.noAccount || r.canceled) && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {r.noAccount && <Badge variant="warning">No account</Badge>}
            {r.canceled && <Badge variant="destructive">Canceled, still airing</Badge>}
          </div>
        )}
        {/* Phones: the screens column is hidden, so it sits under the name. */}
        <div className="mt-1.5 md:hidden">
          <Where r={r} screens={screens} />
        </div>
      </div>
    ),
  },
  {
    key: 'where',
    header: 'Screens',
    hideBelow: 'md',
    cell: (r) => <Where r={r} screens={screens} />,
  },
  {
    key: 'plays',
    header: 'Shown 30d',
    numeric: true,
    value: (r) => r.plays,
    cell: (r) => shown(r.plays),
  },
  {
    key: 'scans',
    header: 'Scans',
    numeric: true,
    hideBelow: 'sm',
    value: (r) => r.scans,
    cell: (r) => shown(r.scans),
  },
]

export function ByAdvertiserTable({ rows, screens }: { rows: AdvertiserDelivery[]; screens: ScreenOption[] }) {
  const columns = useMemo(() => advertiserColumns(screens), [screens])
  return (
    <DataTable
      rows={rows}
      rowId={(r) => r.advertiserId}
      columns={columns}
      views={ADVERTISER_VIEWS}
      defaultSort={{ key: 'name', dir: 'asc' }}
      searchable={(r) => `${r.name} ${r.spots.map((s) => `${s.screenLabel} ${s.adTitle}`).join(' ')}`}
      searchPlaceholder="Find an advertiser or a screen…"
      emptyTitle="Nothing on air"
      emptyHint="Ads show up here once they are approved and on a screen."
    />
  )
}

// ---------------------------------------------------------------------------
// By location
// ---------------------------------------------------------------------------

const LOCATION_VIEWS: SavedView<LocationDelivery>[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'dark', label: 'Screen is off', match: (r) => r.darkScreens > 0, tone: 'bad' },
]

const LOCATION_COLUMNS: Column<LocationDelivery>[] = [
  {
    key: 'name',
    header: 'Location',
    value: (r) => r.name.toLowerCase(),
    className: 'md:w-48',
    cell: (r) => (
      <div className="min-w-0">
        <Link href={`/admin/venues/${r.venueId}`} className="block truncate font-medium hover:underline">
          {r.name}
        </Link>
        {r.darkScreens > 0 && <div className="text-[11px] text-destructive">Screen is off</div>}
        <div className="mt-1.5 md:hidden">
          <ScreenChips spots={r.spots} label={(s) => s.advertiserName} />
        </div>
      </div>
    ),
  },
  {
    key: 'running',
    header: 'Ads playing here',
    hideBelow: 'md',
    cell: (r) => <ScreenChips spots={r.spots} label={(s) => s.advertiserName} />,
  },
  {
    key: 'open',
    header: 'Open spots',
    numeric: true,
    value: (r) => r.slotsTotal - r.slotsUsed,
    cell: (r) => Math.max(0, r.slotsTotal - r.slotsUsed),
  },
  {
    key: 'plays',
    header: 'Shown 30d',
    numeric: true,
    hideBelow: 'sm',
    value: (r) => r.plays,
    cell: (r) => shown(r.plays),
  },
]

export function ByLocationTable({ rows }: { rows: LocationDelivery[] }) {
  return (
    <DataTable
      rows={rows}
      rowId={(r) => r.venueId}
      columns={LOCATION_COLUMNS}
      views={LOCATION_VIEWS}
      defaultSort={{ key: 'name', dir: 'asc' }}
      searchable={(r) => `${r.name} ${r.spots.map((s) => `${s.advertiserName} ${s.adTitle}`).join(' ')}`}
      searchPlaceholder="Find a location or an advertiser…"
      emptyTitle="No screens playing ads"
      emptyHint="A location shows up once an approved ad is on one of its screens."
    />
  )
}

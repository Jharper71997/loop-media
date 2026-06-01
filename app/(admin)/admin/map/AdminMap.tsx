'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CapInput } from '@/app/(admin)/admin/categories/CapInput'
import type { VenuePin } from './MapCanvas'

const MapCanvas = dynamic(() => import('./MapCanvas').then((m) => m.MapCanvas), {
  ssr: false,
  loading: () => (
    <div className="flex h-[70vh] items-center justify-center rounded-lg border border-border text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
})

export function AdminMap({
  venues,
  center,
  advertisers,
  coverage,
  territoryId,
  caps,
}: {
  venues: VenuePin[]
  center: [number, number]
  advertisers: { id: string; name: string }[]
  coverage: Record<string, string[]>
  territoryId: string | null
  caps: { id: string; name: string; cap: number | null }[]
}) {
  const [advertiser, setAdvertiser] = useState('all')
  const highlightIds = advertiser !== 'all' ? coverage[advertiser] ?? [] : null

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <MapCanvas venues={venues} center={center} highlightIds={highlightIds} />

      <div className="space-y-4">
        {/* Advertiser coverage */}
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-medium">Advertiser coverage</p>
            <p className="text-xs text-muted-foreground">
              Highlight the screens an advertiser is currently running on.
            </p>
            <Select value={advertiser} onValueChange={(v) => setAdvertiser(v ?? 'all')}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) =>
                    v && v !== 'all'
                      ? advertisers.find((a) => a.id === v)?.name ?? 'Advertiser'
                      : 'All advertisers'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All advertisers</SelectItem>
                {advertisers.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {advertiser !== 'all' && (
              <p className="text-xs text-muted-foreground">
                Running on {highlightIds?.length ?? 0} venue
                {(highlightIds?.length ?? 0) === 1 ? '' : 's'}.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Category caps */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-medium">Category caps</p>
            {territoryId ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Max advertisers per category in this market.
                </p>
                <div className="space-y-2">
                  {caps.map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-2">
                      <span className="text-sm">{c.name}</span>
                      <CapInput territoryId={territoryId} categoryId={c.id} initial={c.cap} />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Select a single territory in the sidebar to view and edit its caps.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Legend */}
        <Card>
          <CardContent className="space-y-1.5 p-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Legend</p>
            <p>
              <span style={{ color: '#10b981' }}>●</span> screens online ·{' '}
              <span style={{ color: '#ef4444' }}>●</span> offline ·{' '}
              <span style={{ color: '#71717a' }}>●</span> unpaired
            </p>
            <p>
              <span style={{ color: '#d4a333' }}>●</span> selected advertiser&apos;s coverage
            </p>
            <p>Bigger dot = fuller ad loop.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

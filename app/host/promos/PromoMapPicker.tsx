'use client'

import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { MAP_TILE_URL, MAP_TILE_ATTRIBUTION } from '@/lib/mapTiles'
import { US_CENTER, US_ZOOM } from '@/lib/geo'
import { MapFitBounds } from '@/components/app/MapFitBounds'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

// One screen a host can run a free promo on. Availability (open slots / coming
// soon) is computed server-side in the promos page so the map can show the host
// what's actually open and where.
export type PromoVenue = {
  id: string
  name: string
  lat: number | null
  lng: number | null
  open: number
  comingSoon: boolean
}

// Brand-aligned marker palette. Concrete colors (not CSS vars) because Leaflet
// paints these as SVG presentation attributes, which don't resolve var().
const MARKER = {
  selected: '#d4af37', // gold — the screen this promo will run on
  comingSoon: '#94a3b8', // slate — TV not online yet
  full: '#ef4444', // red — screen's loop is full
  open: '#10b981', // emerald — open / selectable
  you: '#3b82f6', // blue — the host's own venue pin
}

// A focused single-select map for the host free-promo flow. Shares the same
// Leaflet primitives as the paid browse map, minus pricing/cart — a host just
// taps one open screen to run their promo on.
export default function PromoMapPicker({
  venues,
  value,
  onSelect,
  homeLoc,
}: {
  venues: PromoVenue[]
  value: string
  onSelect: (id: string) => void
  // The host's own venue, so the map opens on their area with a "you" pin.
  homeLoc?: [number, number] | null
}) {
  const venuePoints = venues
    .filter((v) => v.lat != null && v.lng != null)
    .map((v) => [v.lat as number, v.lng as number] as [number, number])
  const framePoints: [number, number][] = homeLoc ? [homeLoc, ...venuePoints] : venuePoints

  return (
    <MapContainer
      center={US_CENTER}
      zoom={US_ZOOM}
      scrollWheelZoom={false}
      className="h-[40vh] min-h-64 w-full overflow-hidden rounded-xl"
    >
      <TileLayer attribution={MAP_TILE_ATTRIBUTION} url={MAP_TILE_URL} />
      <MapFitBounds points={framePoints} />
      {homeLoc && (
        <>
          {/* Soft halo so the host's own pin reads as "here", distinct from the
              tappable venue dots. */}
          <CircleMarker
            center={homeLoc}
            radius={20}
            pathOptions={{ color: MARKER.you, fillColor: MARKER.you, fillOpacity: 0.12, weight: 0 }}
          />
          <CircleMarker
            center={homeLoc}
            radius={7}
            pathOptions={{ color: '#ffffff', fillColor: MARKER.you, fillOpacity: 1, weight: 2 }}
          >
            <Popup minWidth={120}>
              <p className="text-xs font-medium text-foreground">Your venue</p>
            </Popup>
          </CircleMarker>
        </>
      )}
      {venues
        .filter((v) => v.lat != null && v.lng != null)
        .map((v) => {
          const selected = v.id === value
          const color = selected
            ? MARKER.selected
            : v.comingSoon
              ? MARKER.comingSoon
              : v.open === 0
                ? MARKER.full
                : MARKER.open
          return (
            <CircleMarker
              key={v.id}
              center={[v.lat as number, v.lng as number]}
              radius={selected ? 13 : 11}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: selected ? 0.85 : v.comingSoon ? 0.3 : 0.6,
                weight: selected ? 3 : 2,
                dashArray: v.comingSoon ? '4 3' : undefined,
              }}
            >
              <Popup minWidth={184}>
                <div className="space-y-2">
                  <p className="font-heading text-sm font-semibold text-foreground">{v.name}</p>
                  {v.comingSoon ? (
                    <Badge variant="warning">Coming soon</Badge>
                  ) : v.open === 0 ? (
                    <p className="text-xs font-semibold text-destructive">Screen full</p>
                  ) : (
                    <Button
                      size="sm"
                      variant={selected ? 'secondary' : 'default'}
                      className="w-full"
                      onClick={() => onSelect(v.id)}
                    >
                      {selected ? 'Running here' : 'Run my promo here'}
                    </Button>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          )
        })}
    </MapContainer>
  )
}

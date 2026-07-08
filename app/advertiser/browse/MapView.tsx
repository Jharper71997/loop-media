'use client'

import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { MAP_TILE_URL, MAP_TILE_ATTRIBUTION } from '@/lib/mapTiles'
import { formatCents } from '@/lib/format'
import { TIER_LABEL } from '@/lib/pricing'
import { US_CENTER, US_ZOOM } from '@/lib/geo'
import { MapFitBounds } from '@/components/app/MapFitBounds'
import { Button } from '@/components/ui/button'
import type { BrowseVenue } from './BrowseClient'

// Brand-aligned marker palette. Concrete colors (not CSS vars) because Leaflet
// paints these as SVG presentation attributes, which don't resolve var().
const MARKER = {
  cart: '#d4af37', // gold — in cart
  comingSoon: '#94a3b8', // slate — TV not online yet
  categoryFull: '#9ca3af', // gray — category taken
  full: '#ef4444', // red — screen full
  open: '#10b981', // emerald — open / addable
  you: '#3b82f6', // blue — the advertiser's own location pin
}

// CircleMarkers (vector) avoid Leaflet's default-icon asset issues in bundlers.
export default function MapView({
  venues,
  cart,
  waitlisted,
  onToggle,
  onNotify,
  userLoc,
  frameBounds,
}: {
  venues: BrowseVenue[]
  cart: string[]
  waitlisted: Set<string>
  onToggle: (id: string) => void
  onNotify: (v: BrowseVenue) => void
  // The advertiser's own location (from the browser). When set, the map frames
  // around it and drops a "you're here" pin so nearby screens read at a glance.
  userLoc?: [number, number] | null
  // A ~25mi box [[swLat,swLng],[neLat,neLng]] to frame the initial view on. Every
  // venue below still renders as a marker, so zooming out reveals the whole
  // network — the box only sets where the map opens. Null → frame all venues.
  frameBounds?: [[number, number], [number, number]] | null
}) {
  const venuePoints = venues
    .filter((v) => v.lat != null && v.lng != null)
    .map((v) => [v.lat as number, v.lng as number] as [number, number])
  // Default the viewport to the advertiser's ~25mi box when we have it; otherwise
  // frame all venues (national when there's no location). Markers are unaffected.
  const framePoints: [number, number][] =
    frameBounds ?? (userLoc ? [userLoc, ...venuePoints] : venuePoints)
  // Legend so the 6-color marker palette isn't a guessing game. "You" only shows
  // once we know their location.
  const legend: { color: string; label: string }[] = [
    { color: MARKER.open, label: 'Open' },
    { color: MARKER.cart, label: 'In cart' },
    { color: MARKER.categoryFull, label: 'Category taken' },
    { color: MARKER.full, label: 'Full' },
    ...(userLoc ? [{ color: MARKER.you, label: 'You' }] : []),
  ]

  return (
    <div className="space-y-2">
    <MapContainer
      center={US_CENTER}
      zoom={US_ZOOM}
      scrollWheelZoom={false}
      className="h-[40vh] min-h-64 w-full overflow-hidden rounded-xl lg:h-[calc(100dvh-9rem)]"
    >
      <TileLayer attribution={MAP_TILE_ATTRIBUTION} url={MAP_TILE_URL} />
      <MapFitBounds points={framePoints} />
      {userLoc && (
        <>
          {/* Soft halo so the advertiser's own pin reads as "here", distinct from
              the tappable venue dots. */}
          <CircleMarker
            center={userLoc}
            radius={20}
            pathOptions={{ color: MARKER.you, fillColor: MARKER.you, fillOpacity: 0.12, weight: 0 }}
          />
          <CircleMarker
            center={userLoc}
            radius={7}
            pathOptions={{ color: '#ffffff', fillColor: MARKER.you, fillOpacity: 1, weight: 2 }}
          >
            <Popup minWidth={120}>
              <p className="text-xs font-medium text-foreground">You&apos;re here</p>
            </Popup>
          </CircleMarker>
        </>
      )}
      {venues
        .filter((v) => v.lat != null && v.lng != null)
        .map((v) => {
          const inCart = cart.includes(v.id)
          const color = inCart
            ? MARKER.cart
            : v.categoryFull
              ? MARKER.categoryFull
              : v.open === 0
                ? MARKER.full
                : MARKER.open
          return (
            <CircleMarker
              key={v.id}
              center={[v.lat as number, v.lng as number]}
              radius={inCart ? 13 : 11}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: inCart ? 0.85 : 0.6,
                weight: inCart ? 3 : 2,
              }}
            >
              <Popup minWidth={184}>
                <div className="space-y-2">
                  <div>
                    <p className="font-heading text-sm font-semibold text-foreground">{v.name}</p>
                    <p className="text-xs text-muted-foreground">{TIER_LABEL[v.tier]}</p>
                  </div>
                  <p className="text-foreground">
                    <span className="text-base font-bold">{formatCents(v.priceCents)}</span>
                    <span className="text-xs text-muted-foreground">/mo</span>
                  </p>
                  {v.ownCategory ? (
                    <p className="text-xs font-medium text-muted-foreground">
                      Same business — not available
                    </p>
                  ) : v.open === 0 ? (
                    // Screen is sold out — offer the waitlist so they hear when a slot frees.
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-destructive">Screen full</p>
                      <Button
                        size="sm"
                        variant={waitlisted.has(v.id) ? 'secondary' : 'outline'}
                        className="w-full"
                        onClick={() => onNotify(v)}
                      >
                        {waitlisted.has(v.id) ? 'On waitlist' : 'Notify when a spot opens'}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant={inCart ? 'secondary' : 'default'}
                      className="w-full"
                      onClick={() => onToggle(v.id)}
                    >
                      {inCart ? 'Added — remove' : 'Add to cart'}
                    </Button>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          )
        })}
    </MapContainer>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 px-1 text-[11px] text-muted-foreground">
        {legend.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: l.color }}
              aria-hidden
            />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  )
}

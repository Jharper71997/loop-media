'use client'

import { MapContainer, TileLayer, CircleMarker, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Clock } from 'lucide-react'
import { MAP_TILE_ATTRIBUTION } from '@/lib/mapTiles'
import { useMapTileUrl } from '@/components/app/useMapTiles'
import { formatCents } from '@/lib/format'
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

// A venue's logo as a round map pin: the logo image inside a status-colored ring.
// divIcon renders our own HTML (not Leaflet's default marker image), so it sidesteps
// the bundler asset issue that pushed the rest of the map to CircleMarkers. If the
// image fails to load we fall back to a solid colored dot so a broken URL never
// leaves an empty pin. className '' drops Leaflet's default white icon box.
function buildLogoIcon(url: string, color: string, size: number) {
  const safe = url.replace(/"/g, '&quot;')
  const html =
    `<div style="width:${size}px;height:${size}px;border-radius:9999px;border:3px solid ${color};` +
    `background:#fff;box-shadow:0 1px 5px rgba(0,0,0,.45);overflow:hidden;">` +
    `<img src="${safe}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" ` +
    `onerror="this.style.display='none';this.parentNode.style.background='${color}';" /></div>`
  return L.divIcon({
    html,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

// CircleMarkers (vector) avoid Leaflet's default-icon asset issues in bundlers;
// venues with a logo upgrade to a logo pin (buildLogoIcon) with the same ring color.
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
  const tileUrl = useMapTileUrl()
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
    { color: MARKER.categoryFull, label: 'Competitor' },
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
      <TileLayer attribution={MAP_TILE_ATTRIBUTION} url={tileUrl} />
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
          const center: [number, number] = [v.lat as number, v.lng as number]
          // One popup, shared by the logo-pin and the plain-dot marker below.
          const popup = (
            <Popup minWidth={184}>
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  {v.logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.logoUrl} alt="" loading="lazy" decoding="async" className="size-9 shrink-0 rounded-md object-cover" />
                  )}
                  <div>
                    <p className="font-heading text-sm font-semibold text-foreground">{v.name}</p>
                  </div>
                </div>
                <p className="text-foreground">
                  <span className="text-base font-bold">{formatCents(v.priceCents)}</span>
                  <span className="text-xs text-muted-foreground">/mo</span>
                </p>
                {v.openHours && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3 shrink-0" />
                    {v.openHours}
                  </p>
                )}
                {v.categoryFull ? (
                  <p className="text-xs font-medium text-muted-foreground">
                    {v.ownCategory ? 'Same business' : 'Competing business'} — not available
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
          )
          // A venue with a logo shows it as the pin (round image + status ring);
          // everyone else keeps the vector dot. Same status color drives both.
          return v.logoUrl ? (
            <Marker key={v.id} position={center} icon={buildLogoIcon(v.logoUrl, color, inCart ? 48 : 40)}>
              {popup}
            </Marker>
          ) : (
            <CircleMarker
              key={v.id}
              center={center}
              radius={inCart ? 13 : 11}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: inCart ? 0.85 : 0.6,
                weight: inCart ? 3 : 2,
              }}
            >
              {popup}
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

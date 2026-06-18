'use client'

import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { formatCents } from '@/lib/format'
import { TIER_LABEL } from '@/lib/pricing'
import { US_CENTER, US_ZOOM } from '@/lib/geo'
import { MapFitBounds } from '@/components/app/MapFitBounds'
import type { BrowseVenue } from './BrowseClient'

// CircleMarkers (vector) avoid Leaflet's default-icon asset issues in bundlers.
export default function MapView({
  venues,
  cart,
  waitlisted,
  onToggle,
  onNotify,
}: {
  venues: BrowseVenue[]
  cart: string[]
  waitlisted: Set<string>
  onToggle: (id: string) => void
  onNotify: (v: BrowseVenue) => void
}) {
  const points = venues
    .filter((v) => v.lat != null && v.lng != null)
    .map((v) => [v.lat as number, v.lng as number] as [number, number])
  return (
    <MapContainer
      center={US_CENTER}
      zoom={US_ZOOM}
      scrollWheelZoom={false}
      className="h-[40vh] min-h-64 w-full overflow-hidden rounded-xl"
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapFitBounds points={points} />
      {venues
        .filter((v) => v.lat != null && v.lng != null)
        .map((v) => {
          const inCart = cart.includes(v.id)
          // gold = in cart, slate = coming soon, gray = category taken, red = full, green = open
          const color = inCart
            ? '#d4af37'
            : v.comingSoon
              ? '#94a3b8'
              : v.categoryFull
                ? '#9ca3af'
                : v.open === 0
                  ? '#ef4444'
                  : '#10b981'
          return (
            <CircleMarker
              key={v.id}
              center={[v.lat as number, v.lng as number]}
              radius={inCart ? 13 : 11}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: inCart ? 0.85 : v.comingSoon ? 0.3 : 0.6,
                weight: inCart ? 3 : 2,
                dashArray: v.comingSoon ? '4 3' : undefined,
              }}
            >
              <Popup>
                <div style={{ minWidth: 170 }}>
                  <strong>{v.name}</strong>
                  <br />
                  <span style={{ color: '#666' }}>{TIER_LABEL[v.tier]}</span>
                  <br />
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{formatCents(v.priceCents)}</span>
                  <span style={{ color: '#666' }}>/mo</span>
                  <br />
                  {v.ownCategory ? (
                    <span style={{ color: '#6b7280', fontWeight: 600 }}>
                      Same business — not available
                    </span>
                  ) : v.comingSoon ? (
                    <>
                      <span style={{ color: '#64748b', fontWeight: 600 }}>Coming soon</span>
                      <button
                        onClick={() => onNotify(v)}
                        style={btn(waitlisted.has(v.id) ? '#6b7280' : '#111827')}
                      >
                        {waitlisted.has(v.id) ? '✓ Notify on' : '🔔 Notify me'}
                      </button>
                    </>
                  ) : v.categoryFull ? (
                    <button
                      onClick={() => onNotify(v)}
                      style={btn(waitlisted.has(v.id) ? '#6b7280' : '#111827')}
                    >
                      {waitlisted.has(v.id) ? '✓ Waitlisted' : '🔔 Notify me'}
                    </button>
                  ) : v.open === 0 ? (
                    <span style={{ color: '#ef4444', fontWeight: 600 }}>Screen full</span>
                  ) : (
                    <button
                      onClick={() => onToggle(v.id)}
                      style={btn(inCart ? '#6b7280' : '#0a7d3b')}
                    >
                      {inCart ? '✓ Added — remove' : '+ Add to cart'}
                    </button>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          )
        })}
    </MapContainer>
  )
}

function btn(bg: string): React.CSSProperties {
  return {
    marginTop: 8,
    width: '100%',
    padding: '6px 10px',
    background: bg,
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontWeight: 600,
    cursor: 'pointer',
  }
}

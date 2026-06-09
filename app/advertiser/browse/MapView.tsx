'use client'

import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { formatCents } from '@/lib/format'
import { TIER_LABEL } from '@/lib/pricing'
import type { BrowseVenue } from './BrowseClient'

// CircleMarkers (vector) avoid Leaflet's default-icon asset issues in bundlers.
export default function MapView({
  venues,
  center,
  cart,
  waitlisted,
  onToggle,
  onNotify,
}: {
  venues: BrowseVenue[]
  center: [number, number]
  cart: string[]
  waitlisted: Set<string>
  onToggle: (id: string) => void
  onNotify: (v: BrowseVenue) => void
}) {
  return (
    <MapContainer
      center={center}
      zoom={12}
      scrollWheelZoom
      className="h-[60vh] w-full overflow-hidden rounded-lg"
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {venues
        .filter((v) => v.lat != null && v.lng != null)
        .map((v) => {
          const inCart = cart.includes(v.id)
          // gold = in cart, gray = category taken, red = slots full, green = open
          const color = inCart
            ? '#d4af37'
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
                fillOpacity: inCart ? 0.85 : 0.6,
                weight: inCart ? 3 : 2,
              }}
            >
              <Popup>
                <div style={{ minWidth: 170 }}>
                  <strong>{v.name}</strong>
                  <br />
                  <span style={{ color: '#666' }}>
                    {TIER_LABEL[v.tier]} · {v.foot_traffic_estimate.toLocaleString()} visits/mo
                  </span>
                  <br />
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{formatCents(v.priceCents)}</span>
                  <span style={{ color: '#666' }}>/mo</span>
                  <br />
                  {v.categoryFull ? (
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

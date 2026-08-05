'use client'

import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { MAP_TILE_ATTRIBUTION } from '@/lib/mapTiles'
import { useMapTileUrl } from '@/components/app/useMapTiles'
import { MapFitBounds } from '@/components/app/MapFitBounds'

export type DirectoryMapVenue = {
  id: string
  name: string
  lat: number | null
  lng: number | null
  category: string | null
}

// Public locator map for the business directory. CircleMarkers (vector) sidestep
// Leaflet's default-icon asset issues in bundlers — same approach as the other maps.
export default function DirectoryMapView({
  venues,
  center,
}: {
  venues: DirectoryMapVenue[]
  center: [number, number]
}) {
  const tileUrl = useMapTileUrl()
  const points = venues
    .filter((v) => v.lat != null && v.lng != null)
    .map((v) => [v.lat as number, v.lng as number] as [number, number])
  return (
    <MapContainer
      center={center}
      zoom={12}
      scrollWheelZoom={false}
      // 52vh is most of a phone screen for a map that's context, not the content.
      className="h-[36vh] min-h-56 w-full overflow-hidden rounded-2xl sm:h-[50vh]"
    >
      <TileLayer attribution={MAP_TILE_ATTRIBUTION} url={tileUrl} />
      <MapFitBounds points={points} />
      {venues
        .filter((v) => v.lat != null && v.lng != null)
        .map((v) => {
          // Gold fill with a bronze stroke: the fill alone disappeared into the
          // light basemap's warm land colour.
          return (
            <CircleMarker
              key={v.id}
              center={[v.lat as number, v.lng as number]}
              radius={10}
              pathOptions={{
                color: '#5f3f0a',
                fillColor: '#d4a333',
                fillOpacity: 0.85,
                weight: 2,
              }}
            >
              <Popup>
                <strong>{v.name}</strong>
                {v.category ? (
                  <>
                    <br />
                    {v.category}
                  </>
                ) : null}
              </Popup>
            </CircleMarker>
          )
        })}
    </MapContainer>
  )
}

// Default map framing. Loop Network is a nationwide network, so when there are
// no venues to frame we show the whole US rather than a single city.
export const US_CENTER: [number, number] = [39.8283, -98.5795] // geographic center
export const US_ZOOM = 4

// How close a screen has to be to count as "near you" on the advertiser browse
// map. The advertiser zooms straight to their own area instead of the whole
// network, so we only surface venues within this radius of their location.
export const NEARBY_RADIUS_MI = 25

// Great-circle distance in miles between two [lat, lng] points (haversine).
// Used to rank/filter venues by how close they are to the advertiser.
export function distanceMiles(a: [number, number], b: [number, number]): number {
  const R = 3958.8 // Earth radius, miles
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

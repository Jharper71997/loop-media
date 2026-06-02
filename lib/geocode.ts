// Address → coordinates via OpenStreetMap Nominatim (free, keyless). Server-only.
// Used so admins/hosts only type an address; lat/lng fill in automatically for
// the map. Returns null on any failure (the venue just won't map until set).
export async function geocodeAddress(
  address: string | null | undefined
): Promise<{ lat: number; lng: number } | null> {
  const q = (address ?? '').trim()
  if (!q) return null
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'LoopMedia/1.0 (venue geocoding)' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as Array<{ lat: string; lon: string }>
    if (!Array.isArray(data) || !data[0]) return null
    const lat = Number(data[0].lat)
    const lng = Number(data[0].lon)
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null
    return { lat, lng }
  } catch {
    return null
  }
}

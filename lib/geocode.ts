// Address → coordinates via OpenStreetMap Nominatim (free, keyless). Server-only.
// Structured + US-scoped so an address resolves to the right place: a single
// freeform line with no country bias used to match the highest-"importance"
// result anywhere on Earth (an Indiana street landed in California). Hosts and
// admins only enter an address — never coordinates. Returns null on any failure
// (the venue just won't map until the address is fixed).

export interface AddressParts {
  street?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const HEADERS = { 'User-Agent': 'LoopNetwork/1.0 (venue geocoding)' }

// Nominatim resolves building-level addresses, not unit numbers. A street line
// carrying a suite/unit/site tag ("1250 Western Blvd site 6", "3430 Richlands
// Hwy Suite E") or a lettered house number ("3430D Richlands Hwy") misses the
// structured lookup AND the freeform pass, then silently falls through to the
// city-center locality pin — which is why several venues stacked on one point
// off in the wrong spot. Strip the unit portion before geocoding. The raw line
// is still stored verbatim on the venue for display; only the lookup is cleaned.
export function cleanStreet(street: string): string {
  return street
    // trailing "suite/ste/unit/site/apt/no/#" + its value ("Suite E", "site 6")
    .replace(/[,\s]+(?:suite|ste|unit|site|apt|apartment|rm|room|no|#)\.?\s*\w+\s*$/i, '')
    // lettered house number glued to the digits ("3430D" -> "3430"); the letter
    // must touch the number so directionals like "100 N Main" are left alone.
    .replace(/^(\d+)[a-z]\b/i, '$1')
    .replace(/[,\s]+$/, '')
    .trim()
}

type NominatimRow = { lat: string; lon: string; address?: { country_code?: string } }

function pickUs(rows: NominatimRow[]): { lat: number; lng: number } | null {
  const row =
    rows.find((r) => r.address?.country_code?.toLowerCase() === 'us') ?? rows[0]
  if (!row) return null
  const lat = Number(row.lat)
  const lng = Number(row.lon)
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null
  return { lat, lng }
}

async function structuredSearch(
  fields: { street?: string; city?: string; state?: string; zip?: string }
): Promise<{ lat: number; lng: number } | null> {
  try {
    const p = new URLSearchParams({
      format: 'json',
      addressdetails: '1',
      limit: '5',
      countrycodes: 'us',
    })
    if (fields.street) p.set('street', fields.street)
    if (fields.city) p.set('city', fields.city)
    if (fields.state) p.set('state', fields.state)
    if (fields.zip) p.set('postalcode', fields.zip)
    const res = await fetch(`${NOMINATIM}?${p.toString()}`, { headers: HEADERS })
    if (!res.ok) return null
    const rows = (await res.json()) as NominatimRow[]
    return Array.isArray(rows) ? pickUs(rows) : null
  } catch {
    return null
  }
}

export async function geocodeAddress(
  parts: AddressParts
): Promise<{ lat: number; lng: number } | null> {
  const rawStreet = (parts.street ?? '').trim()
  const city = (parts.city ?? '').trim()
  const state = (parts.state ?? '').trim()
  const zip = (parts.zip ?? '').trim()
  if (!rawStreet && !city && !zip) return null
  // Strip suite/unit tags so the building-level lookup can hit (see cleanStreet).
  const street = cleanStreet(rawStreet)

  // 1) Structured US search — the accurate path when we have city/state/zip.
  const structured = await structuredSearch({ street, city, state, zip })
  if (structured) return structured

  // 2) Freeform US fallback (still country-scoped) if structured found nothing.
  try {
    const q = [street, city, state, zip].filter(Boolean).join(', ')
    const p = new URLSearchParams({
      format: 'json',
      addressdetails: '1',
      limit: '5',
      countrycodes: 'us',
      q,
    })
    const res = await fetch(`${NOMINATIM}?${p.toString()}`, { headers: HEADERS })
    if (res.ok) {
      const rows = (await res.json()) as NominatimRow[]
      const hit = Array.isArray(rows) ? pickUs(rows) : null
      if (hit) return hit
    }
  } catch {
    /* fall through to the locality fallback */
  }

  // 3) Locality fallback — rural / state-highway street addresses often aren't in
  // OSM (e.g. "461 hwy 172" returns nothing). Without this the venue is saved with
  // null coords and silently dropped off the advertiser map. Fall back to an
  // approximate city/zip pin so the venue still appears; an admin can refine it.
  // Only when there's a locality to anchor on (avoids a meaningless country pin).
  if (city || zip) {
    const approx = await structuredSearch({ city, state, zip })
    if (approx) return approx
  }
  return null
}

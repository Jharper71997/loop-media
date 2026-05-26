// Advertiser performance helpers — turn raw placements + QR scans into a daily
// series and a per-location breakdown for the campaign detail page.
//
// Two kinds of number live here, and the UI must keep them honest:
//   • Estimated impressions — derived from each venue's monthly foot_traffic_estimate.
//     TVs don't report plays (see app/api/tv/loop/route.ts), so this is an estimate.
//   • QR scans — MEASURED events (app/r/[code]/route.ts), attributed to a screen + day.
//
// Phase 2 (impression_days rollup + device play-counts) will make estimates vary by
// real online-days and add real plays; these helpers are the seam for that swap.

export const PERF_WINDOW_DAYS = 30

// A distinct venue the campaign's ad is currently running at, with the screen ids
// there (one venue can host several TVs).
export type RunningVenue = {
  venueId: string
  name: string
  lat: number | null
  lng: number | null
  footTraffic: number // ~monthly visitors
  tvIds: string[]
}

export type ScanRow = { tv_id: string | null; scanned_at: string }

export type DailyPoint = { date: string; estImpressions: number; scans: number }

export type LocationRow = {
  venueId: string
  name: string
  estPerDay: number
  estPerMonth: number
  scans: number
}

// Steady per-day estimate: a venue's monthly visitors spread evenly. Counted once
// per venue (not per screen) — two screens in one bar don't double the people walking by.
function estPerDay(footTraffic: number): number {
  return Math.round(footTraffic / 30)
}

function estPerDayTotal(venues: RunningVenue[]): number {
  return venues.reduce((s, v) => s + estPerDay(v.footTraffic), 0)
}

export function estImpressionsPerMonth(venues: RunningVenue[]): number {
  return venues.reduce((s, v) => s + v.footTraffic, 0)
}

// One point per day for the last `days`, oldest→newest, including zero-scan days.
// Days are bucketed by UTC date (the scanned_at ISO prefix) for stable boundaries.
export function dailySeries(
  venues: RunningVenue[],
  scans: ScanRow[],
  days = PERF_WINDOW_DAYS
): DailyPoint[] {
  const est = estPerDayTotal(venues)
  const byDay = new Map<string, number>()
  for (const s of scans) {
    const k = s.scanned_at.slice(0, 10)
    byDay.set(k, (byDay.get(k) ?? 0) + 1)
  }
  const out: DailyPoint[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    const k = d.toISOString().slice(0, 10)
    out.push({ date: k, estImpressions: est, scans: byDay.get(k) ?? 0 })
  }
  return out
}

// Per-venue rows, busiest first. Scans only attribute to a venue when the scan
// carried a screen id (tv_id); untagged scans still count in the daily total.
export function locationRows(venues: RunningVenue[], scans: ScanRow[]): LocationRow[] {
  const tvToVenue = new Map<string, string>()
  for (const v of venues) for (const t of v.tvIds) tvToVenue.set(t, v.venueId)

  const scansByVenue = new Map<string, number>()
  for (const s of scans) {
    if (!s.tv_id) continue
    const vid = tvToVenue.get(s.tv_id)
    if (!vid) continue
    scansByVenue.set(vid, (scansByVenue.get(vid) ?? 0) + 1)
  }

  return venues
    .map((v) => ({
      venueId: v.venueId,
      name: v.name,
      estPerDay: estPerDay(v.footTraffic),
      estPerMonth: v.footTraffic,
      scans: scansByVenue.get(v.venueId) ?? 0,
    }))
    .sort((a, b) => b.estPerMonth - a.estPerMonth)
}

// Mean lat/lng of running venues; falls back to Jacksonville, NC (first market).
export function venuesCenter(venues: RunningVenue[]): [number, number] {
  const pts = venues.filter((v) => v.lat != null && v.lng != null)
  if (!pts.length) return [34.7541, -77.4302]
  const lat = pts.reduce((s, v) => s + (v.lat as number), 0) / pts.length
  const lng = pts.reduce((s, v) => s + (v.lng as number), 0) / pts.length
  return [lat, lng]
}

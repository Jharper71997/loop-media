// Advertiser performance helpers — turn raw placements + QR scans into a daily
// series and a per-location breakdown for the campaign detail page.
//
// Three kinds of number live here, and the UI must keep them honest:
//   • Times shown (plays) — MEASURED proof-of-play from ad_plays (device-secret
//     authenticated, open-hours filtered). This is the real "how many times did my
//     ad play" number and leads the UI.
//   • QR scans — MEASURED events (app/r/[code]/route.ts), attributed to a screen + day.
//   • Estimated reach — derived from each venue's monthly foot_traffic_estimate. A
//     clearly-labeled ESTIMATE, never presented as measured.

export const PERF_WINDOW_DAYS = 30

// A distinct venue the campaign's ad is currently running at, with the screen ids
// there (one venue can host several TVs). `plays` is measured over the window and
// attached by the caller after aggregating ad_plays (0 when not yet computed).
export type RunningVenue = {
  venueId: string
  name: string
  lat: number | null
  lng: number | null
  footTraffic: number // ~monthly visitors (fallback when the host hasn't stated a daily count)
  medianDailyCustomers?: number | null // host-stated typical customers/day; preferred for reach
  tvIds: string[]
  plays?: number // measured plays over the reporting window
  venueType?: string | null // e.g. 'Sports Bar' — for the report's venue-type mix
}

export type ScanRow = { tv_id: string | null; scanned_at: string }

export type DailyPoint = { date: string; estImpressions: number; scans: number }

export type LocationRow = {
  venueId: string
  name: string
  estPerDay: number
  estPerMonth: number
  scans: number
  plays: number // measured times shown over the window
}

// Total measured plays across the running venues.
export function measuredPlaysTotal(venues: RunningVenue[]): number {
  return venues.reduce((s, v) => s + (v.plays ?? 0), 0)
}

// Steady per-day estimate. Counted once per venue (not per screen) — two screens
// in one bar don't double the people walking by. Prefer the host-stated typical
// customers/day; otherwise spread the monthly foot-traffic estimate evenly.
function estPerDay(v: Pick<RunningVenue, 'footTraffic' | 'medianDailyCustomers'>): number {
  return v.medianDailyCustomers != null && v.medianDailyCustomers > 0
    ? v.medianDailyCustomers
    : Math.round(v.footTraffic / 30)
}

// A venue's monthly reach: the daily reach across ~30 days.
function estPerMonth(v: Pick<RunningVenue, 'footTraffic' | 'medianDailyCustomers'>): number {
  return v.medianDailyCustomers != null && v.medianDailyCustomers > 0
    ? v.medianDailyCustomers * 30
    : v.footTraffic
}

function estPerDayTotal(venues: RunningVenue[]): number {
  return venues.reduce((s, v) => s + estPerDay(v), 0)
}

export function estImpressionsPerMonth(venues: RunningVenue[]): number {
  return venues.reduce((s, v) => s + estPerMonth(v), 0)
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
      estPerDay: estPerDay(v),
      estPerMonth: estPerMonth(v),
      scans: scansByVenue.get(v.venueId) ?? 0,
      plays: v.plays ?? 0,
    }))
    .sort((a, b) => b.plays - a.plays || b.estPerMonth - a.estPerMonth)
}

// Mean lat/lng of running venues; falls back to Jacksonville, NC (first market).
export function venuesCenter(venues: RunningVenue[]): [number, number] {
  const pts = venues.filter((v) => v.lat != null && v.lng != null)
  if (!pts.length) return [34.7541, -77.4302]
  const lat = pts.reduce((s, v) => s + (v.lat as number), 0) / pts.length
  const lng = pts.reduce((s, v) => s + (v.lng as number), 0) / pts.length
  return [lat, lng]
}

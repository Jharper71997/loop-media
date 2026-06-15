// Uptime SLA math. We guarantee ~80% of a venue's business hours (not 24/7).
// tv_uptime_days.seconds is the MEASURED on-time per screen per day (heartbeat
// adds 30s/beat). The denominator is EXPECTED on-time, derived from the venue's
// business hours/days. Uptime % = measured / expected over a trailing window,
// capped per day so a long-running screen can't bank credit for closed days.
//
// Pure functions (no DB) so they're usable on server and client.

export const UPTIME_SLA = 0.8 // 80% of business hours
export const UPTIME_WINDOW_DAYS = 30

export type BusinessHours = {
  open: string // 'HH:MM'
  close: string // 'HH:MM'
  days: number[] // 0=Sun .. 6=Sat
}

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  open: '10:00',
  close: '22:00',
  days: [0, 1, 2, 3, 4, 5, 6],
}

export type UptimeDay = { day: string; seconds: number } // day = 'YYYY-MM-DD'

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

// Expected open-seconds for a single calendar date under these hours. 0 on a day
// the venue is closed. Overnight windows (close <= open) wrap past midnight.
export function expectedSecondsForDate(bh: BusinessHours, date: Date): number {
  const dow = date.getUTCDay()
  if (!bh.days.includes(dow)) return 0
  const open = minutesOfDay(bh.open)
  let close = minutesOfDay(bh.close)
  if (close <= open) close += 24 * 60 // overnight (e.g. 18:00 -> 02:00)
  return Math.max(0, (close - open) * 60)
}

export type UptimeSummary = {
  pct: number // 0..1, measured/expected over the window
  measuredSeconds: number
  expectedSeconds: number
  breach: boolean // below the SLA over the window
  openDays: number // business days counted
  hasData: boolean // any expected time at all in the window
}

// Roll daily rows up into a window summary. `endDate` defaults to "today"; the
// window is the last `windowDays` calendar days ending there.
export function summarizeUptime(
  rows: UptimeDay[],
  bh: BusinessHours,
  windowDays = UPTIME_WINDOW_DAYS,
  endDate = new Date()
): UptimeSummary {
  const byDay = new Map<string, number>()
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.seconds)

  let measured = 0
  let expected = 0
  let openDays = 0
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()))
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(end)
    d.setUTCDate(d.getUTCDate() - i)
    const exp = expectedSecondsForDate(bh, d)
    if (exp <= 0) continue
    openDays++
    expected += exp
    const key = d.toISOString().slice(0, 10)
    // Cap a day's measured time at its expected time (no banking past close).
    measured += Math.min(byDay.get(key) ?? 0, exp)
  }

  const pct = expected > 0 ? measured / expected : 0
  return {
    pct,
    measuredSeconds: measured,
    expectedSeconds: expected,
    breach: expected > 0 && pct < UPTIME_SLA,
    openDays,
    hasData: expected > 0,
  }
}

export function formatUptimePct(pct: number): string {
  return `${Math.round(pct * 100)}%`
}

// Read business hours off a venue row, falling back to defaults when unset.
export function venueBusinessHours(v: {
  business_open?: string | null
  business_close?: string | null
  business_days?: number[] | null
}): BusinessHours {
  return {
    open: v.business_open || DEFAULT_BUSINESS_HOURS.open,
    close: v.business_close || DEFAULT_BUSINESS_HOURS.close,
    days: v.business_days && v.business_days.length ? v.business_days : DEFAULT_BUSINESS_HOURS.days,
  }
}

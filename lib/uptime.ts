// Uptime SLA math. We guarantee ~80% of a venue's business hours (not 24/7).
// tv_uptime_days.seconds is the MEASURED on-time per screen per day (heartbeat
// adds 30s/beat). The denominator is EXPECTED on-time, derived from the venue's
// business hours/days. Uptime % = measured / expected over a trailing window,
// capped per day so a long-running screen can't bank credit for closed days.
//
// Pure functions (no DB) so they're usable on server and client.

import { formatPerDayHours, type PerDayHours } from '@/lib/openHours'

export const UPTIME_SLA = 0.8 // 80% of business hours
export const UPTIME_WINDOW_DAYS = 30

export type BusinessHours = {
  open: string // 'HH:MM'
  close: string // 'HH:MM'
  days: number[] // 0=Sun .. 6=Sat
  // Per-weekday windows (migration 0057), authoritative when non-empty. Keys
  // '0'..'6'; a missing key means closed that day. See lib/openHours.ts.
  perDay?: PerDayHours | null
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
  // Per-day hours win: that weekday's window, or closed (0) if it has no entry.
  const win = bh.perDay ? bh.perDay[String(dow)] : null
  const openStr = win ? win.open : bh.days.includes(dow) ? bh.open : null
  const closeStr = win ? win.close : openStr != null ? bh.close : null
  if (openStr == null || closeStr == null) return 0
  const open = minutesOfDay(openStr)
  let close = minutesOfDay(closeStr)
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
// Per-day hours (business_hours) are carried through as the authoritative source.
export function venueBusinessHours(v: {
  business_open?: string | null
  business_close?: string | null
  business_days?: number[] | null
  business_hours?: PerDayHours | null
}): BusinessHours {
  return {
    open: v.business_open || DEFAULT_BUSINESS_HOURS.open,
    close: v.business_close || DEFAULT_BUSINESS_HOURS.close,
    days: v.business_days && v.business_days.length ? v.business_days : DEFAULT_BUSINESS_HOURS.days,
    perDay: v.business_hours && Object.keys(v.business_hours).length ? v.business_hours : null,
  }
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// 'HH:MM' (24h) -> friendly 12h, e.g. '22:00' -> '10 PM', '16:30' -> '4:30 PM'.
function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map((n) => Number(n) || 0)
  const ampm = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

// Compact day summary: 'Every day', 'Mon–Fri', 'Fri–Sun', 'Mon, Wed, Fri'.
// Collapses contiguous runs (>=3 long) into ranges, allowing for week wrap so
// Fri/Sat/Sun reads 'Fri–Sun'.
function formatDays(days: number[]): string {
  const set = [...new Set(days.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b)
  if (set.length === 0) return 'No days'
  if (set.length === 7) return 'Every day'

  // Start the week at the largest gap so a wrapping run stays contiguous.
  let gapStart = 0
  let maxGap = -1
  for (let i = 0; i < set.length; i++) {
    const next = i + 1 === set.length ? set[0] + 7 : set[i + 1]
    const gap = next - set[i]
    if (gap > maxGap) {
      maxGap = gap
      gapStart = (i + 1) % set.length
    }
  }
  const ordered = [...set.slice(gapStart), ...set.slice(0, gapStart)]

  const runs: number[][] = [[ordered[0]]]
  for (let i = 1; i < ordered.length; i++) {
    const run = runs[runs.length - 1]
    if ((ordered[i] - run[run.length - 1] + 7) % 7 === 1) run.push(ordered[i])
    else runs.push([ordered[i]])
  }

  return runs
    .map((r) =>
      r.length >= 3
        ? `${DAY_SHORT[r[0]]}–${DAY_SHORT[r[r.length - 1]]}`
        : r.map((d) => DAY_SHORT[d]).join(', ')
    )
    .join(', ')
}

// One-line operating-hours label for the admin screen list, e.g.
// '10 AM to 10 PM · Every day' or '4 PM to 2 AM · Fri–Sun'. With per-day hours it
// reads 'Mon–Fri 9 AM–5 PM, Sun 1–5 PM'.
export function formatBusinessHours(bh: BusinessHours): string {
  if (bh.perDay && Object.keys(bh.perDay).length) return formatPerDayHours(bh.perDay)
  return `${to12h(bh.open)} to ${to12h(bh.close)} · ${formatDays(bh.days)}`
}

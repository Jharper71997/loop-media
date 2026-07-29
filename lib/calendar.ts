// Content-calendar date helpers. Client-safe (no server imports).
//
// Everything here works in the viewer's LOCAL time and formats to the same
// 'YYYY-MM-DD' the scheduled_creatives.run_on DATE column stores. Deliberately
// not using toISOString() for day math: that converts to UTC first, which puts
// anyone west of Greenwich on the previous day for most of the evening — the
// classic "I clicked the 14th and it saved the 13th" bug.

// How far ahead the calendar lets an advertiser plan. A bit over a year so a
// full 12 months are always reachable no matter what month it is today.
export const MAX_SCHEDULE_DAYS = 400

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// 'YYYY-MM-DD' for `base` shifted by `days`, in local time.
export function isoDayLocal(base: Date, days = 0): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function ymd(year: number, monthIndex: number, day: number): string {
  return `${year}-${`${monthIndex + 1}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`
}

// Parse a 'YYYY-MM-DD' as a LOCAL date (new Date('2026-08-14') would be UTC).
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

// "Fri, Aug 14" / "Fri, Aug 14, 2027" — the year only when it isn't the year
// the calendar is currently showing, so the common case stays short.
export function formatDay(iso: string, showYear = false): string {
  const d = parseDay(iso)
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(showYear ? { year: 'numeric' } : {}),
  })
}

// Day cells for one month grid: leading nulls pad to the correct weekday.
export function monthGrid(year: number, monthIndex: number): (number | null)[] {
  const first = new Date(year, monthIndex, 1).getDay()
  const days = new Date(year, monthIndex + 1, 0).getDate()
  const cells: (number | null)[] = Array(first).fill(null)
  for (let d = 1; d <= days; d++) cells.push(d)
  return cells
}

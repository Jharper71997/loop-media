// Whether an ad play counts as a real impression: it only does if it ran while
// the venue was OPEN. Counting plays at 3am (the screen left on overnight) would
// overstate the audience — and impressions are what advertisers buy.
//
// Hours come from the host at registration/edit. Two shapes coexist:
//   • business_hours (migration 0057) — per-weekday windows, AUTHORITATIVE when
//     present. A JSON object keyed '0'..'6' (0=Sunday); each value {open,close}
//     is that day's window. A weekday with no key is CLOSED. This lets a venue be
//     open different hours on different days (Sun 1–5 but Mon–Fri 9–5).
//   • business_open/close/days (migration 0020) — one window for all open days.
//     The fallback for venues that predate per-day hours (business_hours null).
// Times are local wall-clock 'HH:MM'; days are 0=Sunday .. 6=Saturday. We have no
// per-venue timezone column yet, so we assume the network's home timezone below —
// fine while every venue is Eastern; add a venues.timezone column when the network
// spans zones.

export const NETWORK_TZ = 'America/New_York'

// One day's open window, local wall-clock 'HH:MM'.
export type DayWindow = { open: string; close: string }
// Per-weekday windows, keys '0'..'6' (0=Sunday). Missing key = closed that day.
export type PerDayHours = Record<string, DayWindow>

export type VenueHours = {
  business_open: string | null
  business_close: string | null
  business_days: number[] | null
  // Per-day override; authoritative when non-empty (see file header).
  business_hours?: PerDayHours | null
  timezone?: string | null
}

// Defensively read a business_hours value (from jsonb) into a weekday->window map.
// Returns null when there are no valid day windows, so callers fall back to the
// legacy single-window columns.
function parsePerDay(raw: PerDayHours | null | undefined): Map<number, DayWindow> | null {
  if (!raw || typeof raw !== 'object') return null
  const m = new Map<number, DayWindow>()
  for (const [k, v] of Object.entries(raw)) {
    const d = Number(k)
    if (!Number.isInteger(d) || d < 0 || d > 6) continue
    if (v && typeof v.open === 'string' && typeof v.close === 'string') {
      m.set(d, { open: v.open, close: v.close })
    }
  }
  return m.size ? m : null
}

// The open window for a given weekday (0=Sun), or null if the venue is closed
// that day. Per-day hours win; otherwise the legacy single window applies to the
// days in business_days.
export function windowForDay(hours: VenueHours, weekday: number): DayWindow | null {
  const perDay = parsePerDay(hours.business_hours)
  if (perDay) return perDay.get(weekday) ?? null
  const days = hours.business_days ?? [0, 1, 2, 3, 4, 5, 6]
  if (!days.includes(weekday)) return null
  return { open: hours.business_open || '10:00', close: hours.business_close || '22:00' }
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Local weekday (0-6), minutes-since-midnight, and YYYY-MM-DD for an instant,
// evaluated in the given timezone.
export function localParts(
  iso: string | Date,
  tz: string
): { day: number; min: number; date: string } {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const day = WEEKDAYS.indexOf(get('weekday'))
  const hour = Number(get('hour')) % 24
  const minute = Number(get('minute'))
  return {
    day: day < 0 ? 0 : day,
    min: hour * 60 + minute,
    date: `${get('year')}-${get('month')}-${get('day')}`,
  }
}

export function localDate(iso: string | Date, tz: string = NETWORK_TZ): string {
  return localParts(iso, tz).date
}

// --- Human-readable hours, for showing advertisers when a venue is open before
// they buy a screen there. Same source columns as the SLA math above.

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// '16:30' -> '4:30 PM', '10:00' -> '10 AM', '00:00' -> '12 AM'. Drops ':00'.
function formatTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':')
  let h = Number(hStr)
  const m = Number(mStr) || 0
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return m ? `${h}:${String(m).padStart(2, '0')} ${ampm}` : `${h} ${ampm}`
}

// [1,2,3,4,5] -> 'Mon–Fri'; all seven -> 'Every day'; gaps split into a
// comma list of runs ([0,5,6] -> 'Sun, Fri–Sat').
function formatDays(days: number[]): string {
  const set = [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b)
  if (set.length === 0) return ''
  if (set.length === 7) return 'Every day'
  const runs: [number, number][] = []
  for (const d of set) {
    const last = runs[runs.length - 1]
    if (last && d === last[1] + 1) last[1] = d
    else runs.push([d, d])
  }
  return runs.map(([a, b]) => (a === b ? DAY_ABBR[a] : `${DAY_ABBR[a]}–${DAY_ABBR[b]}`)).join(', ')
}

function formatWindow(w: DayWindow): string {
  return `${formatTime(w.open)}–${formatTime(w.close)}`
}

// Per-day hours as a compact line: 'Mon–Fri 9 AM–5 PM, Sun 1–5 PM'. Consecutive
// open days that share the same window collapse into a range; a single segment
// covering all seven days reads 'Every day, 10 AM–10 PM'. Empty when nothing open.
export function formatPerDayHours(perDay: PerDayHours): string {
  const parsed = parsePerDay(perDay)
  if (!parsed) return ''
  const openDays = [...parsed.keys()].sort((a, b) => a - b)
  // Runs of consecutive weekdays that share an identical open/close window.
  const segs: { a: number; b: number; w: DayWindow }[] = []
  for (const d of openDays) {
    const w = parsed.get(d) as DayWindow
    const last = segs[segs.length - 1]
    if (last && d === last.b + 1 && last.w.open === w.open && last.w.close === w.close) last.b = d
    else segs.push({ a: d, b: d, w })
  }
  const label = (s: { a: number; b: number }) =>
    s.a === s.b
      ? DAY_ABBR[s.a]
      : s.a === 0 && s.b === 6
        ? 'Every day'
        : `${DAY_ABBR[s.a]}–${DAY_ABBR[s.b]}`
  // A lone segment reads best with a comma ('Mon–Fri, 9 AM–5 PM'); with several
  // segments the comma separates them, so days and time join with a space.
  if (segs.length === 1) return `${label(segs[0])}, ${formatWindow(segs[0].w)}`
  return segs.map((s) => `${label(s)} ${formatWindow(s.w)}`).join(', ')
}

// A short "when is this place open" line, e.g. 'Mon–Fri, 10 AM–10 PM' or, with
// per-day hours, 'Mon–Fri 9 AM–5 PM, Sun 1–5 PM'. Returns null when we have no
// usable hours, so the caller can simply hide the line.
export function formatOpenHours(hours: VenueHours): string | null {
  const perDay = parsePerDay(hours.business_hours)
  if (perDay) {
    const obj: PerDayHours = {}
    for (const [d, w] of perDay) obj[String(d)] = w
    return formatPerDayHours(obj) || null
  }
  if (!hours.business_open || !hours.business_close) return null
  const time = `${formatTime(hours.business_open)}–${formatTime(hours.business_close)}`
  const days = formatDays(hours.business_days ?? [0, 1, 2, 3, 4, 5, 6])
  return days ? `${days}, ${time}` : time
}

// Did this play happen during the venue's open hours? Uses that weekday's window
// (per-day when set, else the legacy single window). Handles overnight windows
// (e.g. open 16:00, close 02:00) by wrapping past midnight.
export function isWithinOpenHours(playedAt: string | Date, hours: VenueHours): boolean {
  const tz = hours.timezone || NETWORK_TZ
  const { day, min } = localParts(playedAt, tz)
  const w = windowForDay(hours, day)
  if (!w) return false
  const open = toMin(w.open)
  const close = toMin(w.close)
  if (close > open) return min >= open && min < close
  // Overnight: open..midnight OR midnight..close.
  return min >= open || min < close
}

// --- Editor <-> DB conversion, shared by the BusinessHoursPicker (client) and the
// save actions (server). The editor is one row per weekday, 0=Sun .. 6=Sat.

export type DayEditor = { isOpen: boolean; from: string; to: string }
export type BusinessHoursValue = { days: DayEditor[] } // length 7, index 0=Sun

// All seven days open 10 AM–10 PM — the same default the filter used before.
export function defaultHoursValue(): BusinessHoursValue {
  return { days: Array.from({ length: 7 }, () => ({ isOpen: true, from: '10:00', to: '22:00' })) }
}

// Seed the editor from a venue row: per-day hours when present, else the legacy
// single window applied to whichever days were marked open.
export function hoursValueFromVenue(v: {
  business_open?: string | null
  business_close?: string | null
  business_days?: number[] | null
  business_hours?: PerDayHours | null
}): BusinessHoursValue {
  const perDay = parsePerDay(v.business_hours)
  const openSet = new Set(v.business_days ?? [0, 1, 2, 3, 4, 5, 6])
  const fallFrom = v.business_open || '10:00'
  const fallTo = v.business_close || '22:00'
  const days = Array.from({ length: 7 }, (_, d): DayEditor => {
    if (perDay) {
      const w = perDay.get(d)
      return w ? { isOpen: true, from: w.open, to: w.close } : { isOpen: false, from: fallFrom, to: fallTo }
    }
    return { isOpen: openSet.has(d), from: fallFrom, to: fallTo }
  })
  return { days }
}

// Turn the editor into the columns we persist. business_hours is authoritative;
// the legacy columns are also written as a coarse fallback (open days, and the
// earliest open / latest close) for any reader that hasn't adopted per-day yet.
export function hoursValueToFields(val: BusinessHoursValue): {
  business_hours: PerDayHours | null
  business_days: number[]
  business_open: string
  business_close: string
} {
  const perDay: PerDayHours = {}
  const openDays: number[] = []
  let minOpen: string | null = null
  let maxClose: string | null = null
  val.days.forEach((d, i) => {
    if (!d.isOpen) return
    const from = d.from || '10:00'
    const to = d.to || '22:00'
    perDay[String(i)] = { open: from, close: to }
    openDays.push(i)
    if (minOpen === null || from < minOpen) minOpen = from // 'HH:MM' sorts lexically
    if (maxClose === null || to > maxClose) maxClose = to
  })
  return {
    business_hours: openDays.length ? perDay : null,
    business_days: openDays,
    business_open: minOpen ?? '10:00',
    business_close: maxClose ?? '22:00',
  }
}

// Whether an ad play counts as a real impression: it only does if it ran while
// the venue was OPEN. Counting plays at 3am (the screen left on overnight) would
// overstate the audience — and impressions are what advertisers buy.
//
// Hours come from the host at registration (venues.business_open/close/days, set
// by migration 0020). Times are local wall-clock 'HH:MM'; business_days is
// 0=Sunday .. 6=Saturday. We have no per-venue timezone column yet, so we assume
// the network's home timezone below — fine while every venue is Eastern; add a
// venues.timezone column when the network spans zones.

export const NETWORK_TZ = 'America/New_York'

export type VenueHours = {
  business_open: string | null
  business_close: string | null
  business_days: number[] | null
  timezone?: string | null
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

// Did this play happen during the venue's open hours? Handles overnight windows
// (e.g. open 16:00, close 02:00) by wrapping past midnight.
export function isWithinOpenHours(
  playedAt: string | Date,
  hours: VenueHours
): boolean {
  const tz = hours.timezone || NETWORK_TZ
  const days = hours.business_days ?? [0, 1, 2, 3, 4, 5, 6]
  const { day, min } = localParts(playedAt, tz)
  if (!days.includes(day)) return false
  const open = toMin(hours.business_open || '10:00')
  const close = toMin(hours.business_close || '22:00')
  if (close > open) return min >= open && min < close
  // Overnight: open..midnight OR midnight..close.
  return min >= open || min < close
}

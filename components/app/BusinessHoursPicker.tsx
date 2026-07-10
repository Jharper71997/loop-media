'use client'

import { Input } from '@/components/ui/input'
import { type BusinessHoursValue } from '@/lib/openHours'

// Per-day open hours editor. Each weekday can be toggled open/closed and, when
// open, gets its own open/close window — so a venue can be open Sun 1–5 PM but
// Mon–Fri 9 AM–5 PM. These feed both the advertiser-facing "when is this open"
// line and the uptime SLA denominator (we guarantee uptime during business
// hours, not 24/7). Controlled: the parent owns the 7-day value; conversions to
// and from the DB columns live in lib/openHours.ts (hoursValueFromVenue /
// hoursValueToFields).

export type { BusinessHoursValue }

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function BusinessHoursPicker({
  value,
  onChange,
}: {
  value: BusinessHoursValue
  onChange: (v: BusinessHoursValue) => void
}) {
  function update(i: number, patch: Partial<BusinessHoursValue['days'][number]>) {
    onChange({ days: value.days.map((d, idx) => (idx === i ? { ...d, ...patch } : d)) })
  }
  function copyToAll(i: number) {
    const src = value.days[i]
    onChange({ days: value.days.map((d) => (d.isOpen ? { ...d, from: src.from, to: src.to } : d)) })
  }
  const firstOpen = value.days.findIndex((d) => d.isOpen)

  return (
    <div className="space-y-2">
      {value.days.map((d, i) => (
        <div key={i} className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={d.isOpen}
            aria-label={`${DAY_LABELS[i]} ${d.isOpen ? 'open' : 'closed'}`}
            onClick={() => update(i, { isOpen: !d.isOpen })}
            className={`w-16 shrink-0 rounded-md border py-2 text-sm font-medium transition ${
              d.isOpen
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-transparent text-muted-foreground hover:border-primary/50'
            }`}
          >
            {DAY_LABELS[i].slice(0, 3)}
          </button>
          {d.isOpen ? (
            <div className="flex flex-1 items-center gap-1.5">
              <Input
                type="time"
                value={d.from}
                onChange={(e) => update(i, { from: e.target.value })}
                aria-label={`${DAY_LABELS[i]} opens`}
                className="h-9"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="time"
                value={d.to}
                onChange={(e) => update(i, { to: e.target.value })}
                aria-label={`${DAY_LABELS[i]} closes`}
                className="h-9"
              />
            </div>
          ) : (
            <span className="flex-1 text-sm text-muted-foreground">Closed</span>
          )}
        </div>
      ))}

      {firstOpen >= 0 && (
        <button
          type="button"
          onClick={() => copyToAll(firstOpen)}
          className="text-xs text-primary hover:underline"
        >
          Use {DAY_LABELS[firstOpen]}&rsquo;s hours for every open day
        </button>
      )}

      <p className="text-xs text-muted-foreground">
        Turn off any day you&rsquo;re closed. Ads only run and count while you&rsquo;re open, and we
        keep your screen live for at least 80% of these hours.
      </p>
    </div>
  )
}

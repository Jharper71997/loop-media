'use client'

import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'

// Captures a venue's open/close window + the weekdays it operates. These feed the
// uptime SLA denominator (we guarantee uptime during business hours, not 24/7).
// Controlled: parent owns open/close strings ('HH:MM') and a days array (0=Sun).

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

export type BusinessHoursValue = { open: string; close: string; days: number[] }

export function BusinessHoursPicker({
  value,
  onChange,
}: {
  value: BusinessHoursValue
  onChange: (v: BusinessHoursValue) => void
}) {
  function toggleDay(d: number) {
    const has = value.days.includes(d)
    const days = has ? value.days.filter((x) => x !== d) : [...value.days, d].sort((a, b) => a - b)
    onChange({ ...value, days })
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>Open days</Label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {DAY_LABELS.map((lbl, d) => {
            const on = value.days.includes(d)
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={`size-9 rounded-md border text-sm font-medium transition ${
                  on
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-transparent text-muted-foreground hover:border-primary/50'
                }`}
              >
                {lbl}
              </button>
            )
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Opens</Label>
          <Input
            type="time"
            value={value.open}
            onChange={(e) => onChange({ ...value, open: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Closes</Label>
          <Input
            type="time"
            value={value.close}
            onChange={(e) => onChange({ ...value, close: e.target.value })}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        We keep your screen live for at least 80% of these hours and check it daily.
      </p>
    </div>
  )
}

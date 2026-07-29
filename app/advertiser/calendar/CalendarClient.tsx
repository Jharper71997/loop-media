'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarPlus, ChevronLeft, ChevronRight, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  MAX_SCHEDULE_DAYS,
  MONTH_NAMES,
  WEEKDAY_INITIALS,
  formatDay,
  isoDayLocal,
  monthGrid,
  ymd,
} from '@/lib/calendar'
import { ScheduleSpotForm } from './ScheduleSpotForm'
import { cancelScheduled, rescheduleCreative } from './actions'

export type CalendarCampaign = {
  id: string
  status: string
  title: string
  currentCreativeUrl: string | null
  currentCreativeType: 'image' | 'video'
  qrTargetUrl: string | null
  qrX: number | null
  qrY: number | null
  qrSize: number | null
}

export type ScheduledSpot = {
  id: string
  campaign_id: string
  label: string | null
  creative_url: string
  creative_type: 'image' | 'video'
  run_on: string
  status: 'scheduled' | 'applied' | 'skipped' | 'canceled'
  status_note: string | null
  applied_at: string | null
}

// Status → how the day reads at a glance. Kept to three dot colors on purpose:
// campaigns are told apart by the filter and the day panel, not by a rainbow of
// dots that stops meaning anything past four campaigns.
const DOT: Record<ScheduledSpot['status'], string> = {
  scheduled: 'bg-primary',
  applied: 'bg-emerald-500',
  skipped: 'bg-amber-500',
  canceled: 'bg-muted-foreground',
}

export function CalendarClient({
  campaigns,
  spots,
  userId,
  isMember,
}: {
  campaigns: CalendarCampaign[]
  spots: ScheduledSpot[]
  userId: string
  isMember: boolean
}) {
  const router = useRouter()
  // Freeze "now" for the life of the page. The month grids, the earliest
  // schedulable date and the past/upcoming split all have to agree, and a
  // re-render at 11:59pm shouldn't shift them out from under a half-filled form.
  const [now] = useState(() => new Date())
  const today = isoDayLocal(now)
  const firstSchedulable = isoDayLocal(now, 1)
  const lastSchedulable = isoDayLocal(now, MAX_SCHEDULE_DAYS)

  const [year, setYear] = useState(now.getFullYear())
  const [filter, setFilter] = useState<string>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [pending, start] = useTransition()

  const titleFor = useMemo(
    () => new Map(campaigns.map((c) => [c.id, c.title])),
    [campaigns]
  )

  const visible = useMemo(
    () => (filter === 'all' ? spots : spots.filter((s) => s.campaign_id === filter)),
    [spots, filter]
  )

  // day -> spots on that day, for O(1) cell lookups across 12 month grids.
  const byDay = useMemo(() => {
    const m = new Map<string, ScheduledSpot[]>()
    for (const s of visible) {
      const list = m.get(s.run_on)
      if (list) list.push(s)
      else m.set(s.run_on, [s])
    }
    return m
  }, [visible])

  const upcoming = useMemo(
    () => visible.filter((s) => s.status === 'scheduled' && s.run_on >= today).slice(0, 8),
    [visible, today]
  )

  const selectedSpots = selected ? (byDay.get(selected) ?? []) : []
  const canSchedule = !!selected && selected >= firstSchedulable && selected <= lastSchedulable
  const showYear = year !== now.getFullYear()

  function openDay(iso: string) {
    setSelected(iso)
    setFormOpen(false)
  }

  function remove(id: string) {
    start(async () => {
      const res = await cancelScheduled(id)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Removed from your calendar.')
      router.refresh()
    })
  }

  function move(id: string, runOn: string) {
    if (!runOn) return
    start(async () => {
      const res = await rescheduleCreative(id, runOn)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(`Moved to ${formatDay(runOn, true)}.`)
      setSelected(runOn)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {/* Toolbar: which year, which campaign. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous year"
            onClick={() => setYear((y) => y - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-16 text-center font-heading text-lg font-bold tabular-nums">
            {year}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next year"
            onClick={() => setYear((y) => y + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {campaigns.length > 1 && (
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
              aria-label="Filter by campaign"
            >
              <option value="all">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Legend className="bg-primary" label="Scheduled" />
            <Legend className="bg-emerald-500" label="Went up" />
            <Legend className="bg-amber-500" label="Needs a look" />
          </div>
        </div>
      </div>

      {!isMember && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <span>
            One creative change a week is free, so a weekly plan costs nothing extra. If two spots
            land in the same week, the second waits for the next free change rather than billing you
            — unlimited changes lifts that.
          </span>
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Twelve months at a glance. */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {MONTH_NAMES.map((name, mi) => (
            <Card key={name}>
              <CardContent className="p-3">
                <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">
                  {name}
                </p>
                <div className="grid grid-cols-7 gap-0.5 text-center">
                  {WEEKDAY_INITIALS.map((w, i) => (
                    <span key={i} className="pb-1 text-[10px] text-muted-foreground/70">
                      {w}
                    </span>
                  ))}
                  {monthGrid(year, mi).map((day, i) => {
                    if (day == null) return <span key={`p${i}`} />
                    const iso = ymd(year, mi, day)
                    const daySpots = byDay.get(iso) ?? []
                    const isToday = iso === today
                    const isPast = iso < firstSchedulable
                    const isSelected = iso === selected
                    return (
                      <button
                        key={iso}
                        type="button"
                        onClick={() => openDay(iso)}
                        className={cn(
                          'relative aspect-square rounded-md text-[11px] tabular-nums transition',
                          isSelected
                            ? 'bg-primary text-primary-foreground'
                            : daySpots.length
                              ? 'bg-primary/10 font-semibold text-foreground hover:bg-primary/20'
                              : isPast
                                ? 'text-muted-foreground/40 hover:bg-muted'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                          isToday && !isSelected && 'ring-1 ring-primary/60'
                        )}
                        aria-label={`${formatDay(iso, true)}${daySpots.length ? `, ${daySpots.length} scheduled` : ''}`}
                      >
                        {day}
                        {daySpots.length > 0 && (
                          <span className="absolute inset-x-0 bottom-0.5 flex justify-center gap-0.5">
                            {daySpots.slice(0, 3).map((s) => (
                              <span
                                key={s.id}
                                className={cn(
                                  'size-1 rounded-full',
                                  isSelected ? 'bg-primary-foreground' : DOT[s.status]
                                )}
                              />
                            ))}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Day detail + what's coming. */}
        <div className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardContent className="space-y-3 p-4">
              {!selected ? (
                <p className="text-sm text-muted-foreground">
                  Pick a date to see what is running then, or to schedule a new spot.
                </p>
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-heading text-sm font-bold">{formatDay(selected, true)}</p>
                    {selected < firstSchedulable && (
                      <span className="text-[11px] text-muted-foreground">Past</span>
                    )}
                  </div>

                  {selectedSpots.length === 0 && (
                    <p className="text-sm text-muted-foreground">Nothing scheduled for this date.</p>
                  )}

                  {selectedSpots.map((s) => (
                    <SpotRow
                      key={s.id}
                      spot={s}
                      campaignTitle={titleFor.get(s.campaign_id) ?? 'Campaign'}
                      minDate={firstSchedulable}
                      maxDate={lastSchedulable}
                      pending={pending}
                      onRemove={() => remove(s.id)}
                      onMove={(d) => move(s.id, d)}
                    />
                  ))}

                  {canSchedule &&
                    (formOpen ? (
                      <ScheduleSpotForm
                        campaigns={campaigns}
                        runOn={selected}
                        showYear={showYear}
                        userId={userId}
                        onDone={() => setFormOpen(false)}
                        onCancel={() => setFormOpen(false)}
                      />
                    ) : (
                      <Button size="sm" className="w-full" onClick={() => setFormOpen(true)}>
                        <CalendarPlus className="size-4" /> Schedule a spot
                      </Button>
                    ))}

                  {!canSchedule && selected >= firstSchedulable && (
                    <p className="text-xs text-muted-foreground">
                      You can plan about a year ahead.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {upcoming.length > 0 && (
            <Card>
              <CardContent className="space-y-2 p-4">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground">
                  Coming up
                </p>
                {upcoming.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setYear(Number(s.run_on.slice(0, 4)))
                      openDay(s.run_on)
                    }}
                    className="flex w-full items-center gap-2.5 rounded-md p-1 text-left transition hover:bg-muted"
                  >
                    <Thumb spot={s} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {s.label || titleFor.get(s.campaign_id) || 'Spot'}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDay(s.run_on, s.run_on.slice(0, 4) !== `${now.getFullYear()}`)}
                      </span>
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('size-1.5 rounded-full', className)} />
      {label}
    </span>
  )
}

function Thumb({ spot }: { spot: ScheduledSpot }) {
  return (
    <span className="grid aspect-video w-14 shrink-0 place-items-center overflow-hidden rounded bg-muted">
      {spot.creative_type === 'video' ? (
        <video src={spot.creative_url} className="h-full w-full object-cover" muted playsInline />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={spot.creative_url} alt="" className="h-full w-full object-cover" />
      )}
    </span>
  )
}

function SpotRow({
  spot,
  campaignTitle,
  minDate,
  maxDate,
  pending,
  onRemove,
  onMove,
}: {
  spot: ScheduledSpot
  campaignTitle: string
  minDate: string
  maxDate: string
  pending: boolean
  onRemove: () => void
  onMove: (runOn: string) => void
}) {
  const editable = spot.status === 'scheduled'
  return (
    <div className="space-y-2 rounded-lg border border-border p-2.5">
      <div className="flex items-start gap-2.5">
        <Thumb spot={spot} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{spot.label || campaignTitle}</p>
          <p className="truncate text-xs text-muted-foreground">{campaignTitle}</p>
        </div>
        <Badge
          variant={
            spot.status === 'applied' ? 'success' : spot.status === 'skipped' ? 'outline' : 'secondary'
          }
        >
          {spot.status === 'applied'
            ? 'Went up'
            : spot.status === 'skipped'
              ? 'Did not run'
              : 'Scheduled'}
        </Badge>
      </div>

      {spot.status_note && <p className="text-xs text-muted-foreground">{spot.status_note}</p>}

      {editable && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            defaultValue={spot.run_on}
            min={minDate}
            max={maxDate}
            disabled={pending}
            onChange={(e) => onMove(e.target.value)}
            className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs"
            aria-label="Move to another date"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            onClick={onRemove}
            aria-label="Remove from calendar"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Clock, GripVertical, Phone, Mail, Snowflake } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCents } from '@/lib/format'
import {
  followUpState,
  sourceLabel,
  daysSince,
  STALE_DAYS,
  FOLLOW_UP_TONE,
  type Opportunity,
  type OpportunityKind,
  type StageDef,
} from '@/lib/pipeline'
import { moveStage } from './actions'

// The board.
//
// Cards move two ways on purpose. Dragging is the fast path on a desktop; the
// per-card stage <select> is the one that works on a phone, with a keyboard, and
// with a screen reader. This is sold in bars and parking lots, so "drag only"
// would mean the board is unusable exactly where the work happens. No drag-and-
// drop library is involved — native HTML5 events are enough for a Kanban and
// avoid a dependency for one screen.

export interface BoardColumnData {
  key: string
  label: string
  meaning: string
  items: Opportunity[]
  valueCents: number
}

export function Board({
  kind,
  columns,
  stages,
}: {
  kind: OpportunityKind
  columns: BoardColumnData[]
  stages: StageDef[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // Mirrors the server data so a card jumps columns immediately; the refresh
  // below reconciles. On failure we snap back rather than leaving a lie on
  // screen.
  const [cols, setCols] = useState(columns)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)

  // A new server render (filter change, refresh) has to win over local state.
  const [lastColumns, setLastColumns] = useState(columns)
  if (lastColumns !== columns) {
    setLastColumns(columns)
    setCols(columns)
  }

  function move(id: string, toStage: string) {
    const from = cols.find((c) => c.items.some((o) => o.id === id))
    if (!from || from.key === toStage) return
    const card = from.items.find((o) => o.id === id)!
    const snapshot = cols

    setCols((prev) =>
      prev.map((c) => {
        if (c.key === from.key) {
          return {
            ...c,
            items: c.items.filter((o) => o.id !== id),
            valueCents: c.valueCents - card.monthlyCents,
          }
        }
        if (c.key === toStage) {
          return {
            ...c,
            items: [card, ...c.items],
            valueCents: c.valueCents + card.monthlyCents,
          }
        }
        return c
      })
    )

    startTransition(async () => {
      const res = await moveStage(id, toStage)
      if (res.error) {
        setCols(snapshot)
        toast.error(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {cols.map((col) => (
        <section
          key={col.key}
          onDragOver={(e) => {
            e.preventDefault()
            setOverKey(col.key)
          }}
          onDragLeave={() => setOverKey((k) => (k === col.key ? null : k))}
          onDrop={(e) => {
            e.preventDefault()
            setOverKey(null)
            const id = dragId ?? e.dataTransfer.getData('text/plain')
            if (id) move(id, col.key)
            setDragId(null)
          }}
          className={cn(
            'flex w-64 shrink-0 flex-col rounded-lg border bg-card transition-colors',
            overKey === col.key ? 'border-primary bg-accent/40' : 'border-border'
          )}
        >
          <header className="shrink-0 border-b border-border px-2.5 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {col.label}
              </h2>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                {col.items.length}
                {col.valueCents > 0 && ` · ${formatCents(col.valueCents)}`}
              </span>
            </div>
            <p className="truncate text-[10px] text-muted-foreground/80">{col.meaning}</p>
          </header>

          <div className="min-h-24 flex-1 space-y-1.5 overflow-y-auto p-1.5">
            {col.items.length === 0 ? (
              <p className="px-1.5 py-4 text-center text-[11px] text-muted-foreground/70">
                Nothing here
              </p>
            ) : (
              col.items.map((o) => (
                <Card
                  key={o.id}
                  o={o}
                  kind={kind}
                  stages={stages}
                  pending={pending}
                  onDragStart={() => setDragId(o.id)}
                  onDragEnd={() => setDragId(null)}
                  onMove={(to) => move(o.id, to)}
                />
              ))
            )}
          </div>
        </section>
      ))}
    </div>
  )
}

function Card({
  o,
  kind,
  stages,
  pending,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  o: Opportunity
  kind: OpportunityKind
  stages: StageDef[]
  pending: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onMove: (toStage: string) => void
}) {
  const fu = followUpState(o.nextStepAt)
  const cold = daysSince(o.lastTouchAt)
  const isCold = cold != null && cold >= STALE_DAYS && fu === 'none'

  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', o.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      className="group/card cursor-grab rounded-md border border-border bg-background p-2 active:cursor-grabbing"
    >
      <div className="flex items-start gap-1">
        <GripVertical className="mt-0.5 size-3 shrink-0 text-muted-foreground/40" aria-hidden />
        <Link
          href={`/admin/pipeline/${o.id}`}
          className="min-w-0 flex-1 text-[13px] font-medium leading-snug hover:underline"
        >
          {o.businessName}
        </Link>
        {o.monthlyCents > 0 && (
          <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums">
            {formatCents(o.monthlyCents)}
          </span>
        )}
      </div>

      {(o.city || o.source) && (
        <p className="mt-0.5 truncate pl-4 text-[10px] text-muted-foreground">
          {[o.city, o.source ? sourceLabel(o.source) : null].filter(Boolean).join(' · ')}
        </p>
      )}

      {o.nextStep && (
        <p className={cn('mt-1 flex items-start gap-1 pl-4 text-[10px]', FOLLOW_UP_TONE[fu])}>
          <Clock className="mt-px size-2.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            {o.nextStep}
            {o.nextStepAt && ` · ${shortDate(o.nextStepAt)}`}
          </span>
        </p>
      )}

      {isCold && (
        <p className="mt-1 flex items-center gap-1 pl-4 text-[10px] text-muted-foreground">
          <Snowflake className="size-2.5 shrink-0" aria-hidden />
          No contact in {cold} days
        </p>
      )}

      <div className="mt-1.5 flex items-center gap-1 pl-4">
        {o.phone && (
          <a
            href={`tel:${o.phone}`}
            title={o.phone}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Phone className="size-3" />
            <span className="sr-only">Call {o.businessName}</span>
          </a>
        )}
        {o.email && (
          <a
            href={`mailto:${o.email}`}
            title={o.email}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Mail className="size-3" />
            <span className="sr-only">Email {o.businessName}</span>
          </a>
        )}

        {/* The accessible path to the same action as dragging. */}
        <select
          value={o.stage}
          disabled={pending}
          onChange={(e) => onMove(e.target.value)}
          aria-label={`Stage for ${o.businessName}`}
          className="ml-auto max-w-[7.5rem] truncate rounded border border-transparent bg-transparent py-0.5 text-[10px] text-muted-foreground outline-none hover:border-border focus:border-border disabled:opacity-50"
        >
          {stages.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <span className="sr-only">{kind === 'host' ? 'Host prospect' : 'Advertiser prospect'}</span>
    </article>
  )
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

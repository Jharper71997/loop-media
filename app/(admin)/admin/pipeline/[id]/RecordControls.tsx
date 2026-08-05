'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Pencil, Trophy, X, XCircle } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  EVENT_KINDS,
  SOURCES,
  stagesFor,
  wonLabel,
  lostLabel,
  type LoggableEventKind,
  type OpportunityKind,
  type OpportunityPatchField,
} from '@/lib/pipeline'
import {
  updateOpportunity,
  logActivity,
  setNextStep,
  markWon,
  markLost,
  moveStage,
} from '../actions'

// The controls on a single record. Everything that changes an opportunity lives
// here so the server page stays a pure read.

// ---------------------------------------------------------------------------
// Field — click the value to edit it, same interaction as the settings page.
// ---------------------------------------------------------------------------

export function Field({
  id,
  field,
  value,
  label,
  placeholder = 'Not set',
  kind = 'text',
  href,
}: {
  id: string
  field: OpportunityPatchField
  value: string | number | null
  label: string
  placeholder?: string
  kind?: 'text' | 'money' | 'number'
  // Renders the saved value as a link (mailto:, tel:) when there is one.
  href?: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const display =
    value == null || value === ''
      ? null
      : kind === 'money'
        ? `$${(Number(value) / 100).toFixed(Number(value) % 100 === 0 ? 0 : 2)}`
        : String(value)

  function open() {
    setDraft(
      value == null
        ? ''
        : kind === 'money'
          ? String(Number(value) / 100)
          : String(value)
    )
    setEditing(true)
  }

  function commit() {
    start(async () => {
      const raw = draft.trim()
      let patch: Record<string, unknown>
      if (kind === 'money') {
        const n = Number(raw.replace(/[$,\s]/g, ''))
        if (raw && !Number.isFinite(n)) {
          toast.error('That is not an amount.')
          return
        }
        patch = { [field]: raw ? Math.round(n * 100) : 0 }
      } else if (kind === 'number') {
        const n = Number(raw)
        patch = { [field]: raw && Number.isFinite(n) ? Math.round(n) : null }
      } else {
        patch = { [field]: raw || null }
      }

      const res = await updateOpportunity(id, patch)
      if (res.error) {
        toast.error(res.error)
        return
      }
      setEditing(false)
      router.refresh()
    })
  }

  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-1.5">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      {editing ? (
        <span className="flex min-w-0 items-center gap-1">
          <Input
            value={draft}
            autoFocus
            disabled={pending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              }
              if (e.key === 'Escape') setEditing(false)
            }}
            className="h-7 w-40 text-[13px]"
          />
          <button
            type="button"
            onClick={commit}
            disabled={pending}
            title="Save"
            className="rounded p-1 text-success hover:bg-accent disabled:opacity-50"
          >
            <Check className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={pending}
            title="Cancel"
            className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-1">
          {display && href ? (
            <a href={href} className="truncate text-[13px] hover:underline">
              {display}
            </a>
          ) : (
            <span
              className={cn(
                'truncate text-[13px]',
                !display && 'italic text-muted-foreground/70',
                kind !== 'text' && 'font-mono tabular-nums'
              )}
            >
              {display ?? placeholder}
            </span>
          )}
          <button
            type="button"
            onClick={open}
            title={`Edit ${label.toLowerCase()}`}
            className="rounded p-0.5 text-muted-foreground opacity-40 hover:bg-accent hover:opacity-100"
          >
            <Pencil className="size-3" />
          </button>
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Source — a fixed list, so it stays countable on the reports page.
// ---------------------------------------------------------------------------

export function SourceField({ id, value }: { id: string; value: string | null }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-1.5">
      <span className="shrink-0 text-[11px] text-muted-foreground">Source</span>
      <select
        value={value ?? ''}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            const res = await updateOpportunity(id, { source: e.target.value || null })
            if (res.error) toast.error(res.error)
            else router.refresh()
          })
        }
        className="max-w-[10rem] truncate rounded border border-transparent bg-transparent text-[13px] outline-none hover:border-border focus:border-border disabled:opacity-50"
      >
        <option value="">Unknown</option>
        {SOURCES.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export function StagePicker({
  id,
  kind,
  stage,
  disabled,
}: {
  id: string
  kind: OpportunityKind
  stage: string
  disabled?: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <select
      value={stage}
      disabled={pending || disabled}
      aria-label="Stage"
      onChange={(e) =>
        start(async () => {
          const res = await moveStage(id, e.target.value)
          if (res.error) toast.error(res.error)
          else router.refresh()
        })
      }
      className="h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
    >
      {stagesFor(kind).map((s) => (
        <option key={s.key} value={s.key}>
          {s.label}
        </option>
      ))}
    </select>
  )
}

// ---------------------------------------------------------------------------
// Next step
// ---------------------------------------------------------------------------

export function NextStepForm({
  id,
  nextStep,
  nextStepAt,
}: {
  id: string
  nextStep: string | null
  nextStepAt: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [step, setStep] = useState(nextStep ?? '')
  const [at, setAt] = useState(nextStepAt ? nextStepAt.slice(0, 10) : '')

  function save(clearing = false) {
    start(async () => {
      const res = clearing
        ? await setNextStep(id, '', null)
        : await setNextStep(id, step, at ? new Date(`${at}T09:00:00`).toISOString() : null)
      if (res.error) {
        toast.error(res.error)
        return
      }
      if (clearing) {
        setStep('')
        setAt('')
      }
      toast.success(clearing ? 'Follow-up cleared' : 'Follow-up set')
      router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      <div>
        <Label className="text-[11px] text-muted-foreground">What happens next</Label>
        <Input
          value={step}
          onChange={(e) => setStep(e.target.value)}
          placeholder="Call back and ask for the owner"
          className="mt-1 h-8 text-[13px]"
        />
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label className="text-[11px] text-muted-foreground">When</Label>
          <Input
            type="date"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            className="mt-1 h-8 text-[13px]"
          />
        </div>
        <Button size="sm" onClick={() => save()} disabled={pending}>
          Set
        </Button>
        {(nextStep || nextStepAt) && (
          <Button size="sm" variant="ghost" onClick={() => save(true)} disabled={pending}>
            Clear
          </Button>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Anything due today or overdue shows up on Today, in the same list as unpaid accounts.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Activity composer
// ---------------------------------------------------------------------------

export function Composer({ id }: { id: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [kind, setKind] = useState<LoggableEventKind>('note')
  const [body, setBody] = useState('')

  function submit() {
    if (!body.trim()) {
      toast.error('Nothing to log.')
      return
    }
    start(async () => {
      const res = await logActivity(id, kind, body)
      if (res.error) {
        toast.error(res.error)
        return
      }
      setBody('')
      router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {EVENT_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={cn(
              'rounded-md px-2 py-0.5 text-[11px] capitalize transition-colors',
              k === kind
                ? 'bg-primary/10 font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent'
            )}
          >
            {k}
          </button>
        ))}
      </div>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What was said?"
        rows={3}
        className="text-[13px]"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">Logging stamps the last-contact date</span>
        <Button size="sm" onClick={submit} disabled={pending}>
          {pending ? 'Saving…' : 'Log it'}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Won / lost
// ---------------------------------------------------------------------------

export function CloseControls({
  id,
  kind,
  status,
  businessName,
}: {
  id: string
  kind: OpportunityKind
  status: 'open' | 'won' | 'lost'
  businessName: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [lostOpen, setLostOpen] = useState(false)
  const [reason, setReason] = useState('')

  if (status !== 'open') {
    return (
      <span className="text-[11px] text-muted-foreground">
        Move it back to a stage to reopen.
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await markWon(id)
            if (res.error) {
              toast.error(res.error)
              return
            }
            toast.success(
              kind === 'host'
                ? `${businessName} is a host — venue created, hidden until a screen is live.`
                : `${businessName} won. Set the deal up next.`
            )
            router.refresh()
            if (kind === 'advertiser') router.push(`/admin/deals/new?opportunity=${id}`)
          })
        }
      >
        <Trophy className="size-4" /> {wonLabel(kind)}
      </Button>

      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogTrigger render={<Button size="sm" variant="outline" />}>
          <XCircle className="size-4" /> {lostLabel(kind)}
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {lostLabel(kind)} — {businessName}
            </DialogTitle>
            <DialogDescription>
              Why? This is the objection the pitch has to answer next time, and it is the only part
              of a lost deal worth keeping.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Already signed with Digital Wave for the year"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await markLost(id, reason)
                  if (res.error) {
                    toast.error(res.error)
                    return
                  }
                  setLostOpen(false)
                  router.refresh()
                })
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function DealHandoffLink({ id }: { id: string }) {
  return (
    <a
      href={`/admin/deals/new?opportunity=${id}`}
      className={buttonVariants({ size: 'sm', variant: 'outline' })}
    >
      Set up the deal
    </a>
  )
}

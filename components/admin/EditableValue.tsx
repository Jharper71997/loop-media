'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Pencil, RotateCcw, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SETTINGS,
  DEFAULT_SETTINGS,
  formatSetting,
  toInputValue,
  inputSuffix,
  parseSettingInput,
  type SettingKey,
} from '@/lib/settings'
import { saveSetting, resetSetting } from '@/app/(admin)/admin/settings/actions'

// Click the number where you see it.
//
// The rule Jacob picked: any business number is editable at the point it is
// displayed, not only on a settings screen. So this renders as ordinary text
// until you hover it — then it picks up a dotted underline and a pencil, and one
// click turns it into an input.
//
// It parses on the client purely to show the error immediately; the server
// action re-parses and is the real gate. After a successful save it calls
// router.refresh() so every OTHER number on the page that derives from this one
// (a goal percentage, a gap-to-target) recomputes rather than going stale.

export function EditableValue({
  settingKey,
  value,
  className,
  // Show a reset-to-default control while editing. Off in dense contexts.
  allowReset = true,
}: {
  settingKey: SettingKey
  value: number | string
  className?: string
  allowReset?: boolean
}) {
  const def = SETTINGS[settingKey]
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [local, setLocal] = useState(value)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // The server is the source of truth. `local` only exists to show the new value
  // in the instant between the action returning and router.refresh() landing, so
  // when a fresh server value arrives it wins. Adjusted during render (React's
  // documented pattern for a prop-derived reset) rather than in an effect, which
  // would render the stale value once first.
  const [lastServerValue, setLastServerValue] = useState(value)
  if (lastServerValue !== value) {
    setLastServerValue(value)
    setLocal(value)
  }

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function open() {
    setDraft(toInputValue(settingKey, local))
    setError(null)
    setEditing(true)
  }

  function commit() {
    const parsed = parseSettingInput(settingKey, draft)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    // Nothing typed that differs — don't spend a write.
    if (parsed.value === local) {
      setEditing(false)
      return
    }
    startTransition(async () => {
      const res = await saveSetting(settingKey, draft)
      if (res.error) {
        setError(res.error)
        return
      }
      if (res.value !== undefined) setLocal(res.value)
      setEditing(false)
      router.refresh()
    })
  }

  function reset() {
    startTransition(async () => {
      const res = await resetSetting(settingKey)
      if (res.error) {
        setError(res.error)
        return
      }
      if (res.value !== undefined) setLocal(res.value)
      setEditing(false)
      router.refresh()
    })
  }

  const suffix = inputSuffix(settingKey)
  const isDefault = local === DEFAULT_SETTINGS[settingKey]

  if (!editing) {
    return (
      <button
        type="button"
        onClick={open}
        title={`${def.label} — click to edit${def.affects ? `. Changes ${def.affects}.` : ''}`}
        className={cn(
          'group/edit inline-flex items-center gap-1 rounded-sm underline-offset-4 hover:underline hover:decoration-dotted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          className
        )}
      >
        {formatSetting(settingKey, local)}
        <Pencil className="size-3 shrink-0 opacity-0 transition-opacity group-hover/edit:opacity-60" />
      </button>
    )
  }

  return (
    <span className="inline-flex flex-col gap-0.5 align-bottom">
      <span className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          disabled={pending}
          onChange={(e) => {
            setDraft(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
          }}
          // Width tracks the content so a $75 field doesn't reserve a text box.
          size={Math.max(6, draft.length + 2)}
          className={cn(
            'min-w-0 rounded-md border bg-background px-1.5 py-0.5 font-mono text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring/40',
            error ? 'border-destructive' : 'border-input'
          )}
          aria-label={def.label}
          aria-invalid={!!error}
        />
        {suffix && <span className="text-[11px] text-muted-foreground">{suffix}</span>}
        <button
          type="button"
          onClick={commit}
          disabled={pending}
          title="Save"
          className="rounded-md p-1 text-success hover:bg-accent disabled:opacity-50"
        >
          <Check className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={pending}
          title="Cancel"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent disabled:opacity-50"
        >
          <X className="size-3.5" />
        </button>
        {allowReset && !isDefault && (
          <button
            type="button"
            onClick={reset}
            disabled={pending}
            title={`Reset to ${formatSetting(settingKey, DEFAULT_SETTINGS[settingKey])}`}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" />
          </button>
        )}
      </span>
      {error ? (
        <span className="text-[11px] text-destructive">{error}</span>
      ) : (
        def.affects && (
          <span className="text-[11px] text-muted-foreground">Changes {def.affects}</span>
        )
      )}
    </span>
  )
}

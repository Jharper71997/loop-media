'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { SOURCES, KIND_LABEL, type OpportunityKind } from '@/lib/pipeline'
import { createOpportunity } from './actions'

// Adding a prospect has to be faster than not adding one, or it won't happen —
// so business name is the only required field and everything else can be filled
// in later from the record page.

export function NewOpportunityDialog({
  kind,
  categories,
  stage,
  stageLabel,
  variant = 'button',
}: {
  kind: OpportunityKind
  categories: { id: string; name: string }[]
  /** Drop the new card straight into this column. Defaults to the first. */
  stage?: string
  stageLabel?: string
  /** 'icon' is the compact trigger that sits in a column header. */
  variant?: 'button' | 'icon'
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  const [businessName, setBusinessName] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [monthly, setMonthly] = useState(kind === 'advertiser' ? '75' : '')
  const [source, setSource] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [nextStep, setNextStep] = useState('')
  const [nextStepAt, setNextStepAt] = useState('')

  function reset() {
    setBusinessName('')
    setContactName('')
    setEmail('')
    setPhone('')
    setCity('')
    setMonthly(kind === 'advertiser' ? '75' : '')
    setSource('')
    setCategoryId('')
    setNextStep('')
    setNextStepAt('')
  }

  function submit() {
    if (!businessName.trim()) {
      toast.error('A business name is required.')
      return
    }
    start(async () => {
      const dollars = Number(monthly.replace(/[$,\s]/g, ''))
      const res = await createOpportunity({
        kind,
        stage: stage ?? null,
        businessName,
        contactName,
        email,
        phone,
        city,
        categoryId: categoryId || null,
        source: source || null,
        monthlyCents: Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : 0,
        nextStep: nextStep || null,
        // A date alone is a reminder that says nothing, so it only counts when
        // there is a step to go with it.
        nextStepAt: nextStep && nextStepAt ? new Date(`${nextStepAt}T09:00:00`).toISOString() : null,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(`${businessName.trim()} added`)
      reset()
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {variant === 'icon' ? (
        <DialogTrigger
          render={
            <button
              type="button"
              title={`Add a prospect to ${stageLabel ?? 'this column'}`}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            />
          }
        >
          <Plus className="size-4" />
          <span className="sr-only">Add a prospect to {stageLabel ?? 'this column'}</span>
        </DialogTrigger>
      ) : (
        <DialogTrigger render={<Button size="sm" />}>
          <Plus className="size-4" /> Add prospect
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New {kind === 'host' ? 'host' : 'advertiser'} prospect</DialogTitle>
          <DialogDescription>
            Goes to {stageLabel ? `“${stageLabel}”` : 'the first column'} in {KIND_LABEL[kind]}.
            Only the business name is required.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Business" className="sm:col-span-2">
            <Input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder={kind === 'host' ? "Dragon's Breath" : 'Joyas Detailing'}
              autoFocus
            />
          </Field>
          <Field label="Contact">
            <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          </Field>
          <Field label="Email">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" />
          </Field>
          <Field label="City">
            <Input value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
          <Field label={kind === 'host' ? 'Worth per month' : 'Monthly value'}>
            <Input
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              inputMode="decimal"
              placeholder="75"
            />
          </Field>
          <Field label="How we found them">
            <NativeSelect value={source} onChange={setSource} placeholder="Unknown">
              {SOURCES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label={kind === 'host' ? 'What they sell' : 'Their category'}
            className="sm:col-span-2"
            hint={
              kind === 'host'
                ? 'This becomes the category you can never sell into their venue.'
                : undefined
            }
          >
            <NativeSelect value={categoryId} onChange={setCategoryId} placeholder="Not set">
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Next step">
            <Input
              value={nextStep}
              onChange={(e) => setNextStep(e.target.value)}
              placeholder="Call and ask for the owner"
            />
          </Field>
          <Field label="When">
            <Input
              type="date"
              value={nextStepAt}
              onChange={(e) => setNextStepAt(e.target.value)}
              disabled={!nextStep}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Adding…' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string
  hint?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

// A native select: the list is short, it needs no search, and it is the control
// that behaves correctly inside a dialog on a phone.
function NativeSelect({
  value,
  onChange,
  placeholder,
  children,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
    >
      <option value="">{placeholder}</option>
      {children}
    </select>
  )
}

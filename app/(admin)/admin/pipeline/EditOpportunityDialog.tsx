'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Pencil, MailPlus } from 'lucide-react'
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
import { SOURCES, type Opportunity } from '@/lib/pipeline'
import { updateOpportunity } from './actions'

// Editing a prospect from the card itself.
//
// Most of what you learn about a prospect you learn in the ten seconds after
// they pick up the phone — a real contact name, the email they actually read,
// the fact they are not a barber shop. Making that a trip to the record page
// meant it got remembered instead of typed, and remembered means lost. Half
// these cards came off phone-only vcards with no email at all, so this is also
// the only way an email address ever gets onto one.
//
// Fields mirror the add dialog on purpose: the same shape whether a business is
// thirty seconds old or thirty days.

export function EditOpportunityDialog({
  opportunity,
  categories,
  /** Open straight away with the email field focused. */
  focus,
}: {
  opportunity: Opportunity
  categories: { id: string; name: string }[]
  focus?: 'email'
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  const o = opportunity
  const [businessName, setBusinessName] = useState(o.businessName)
  const [contactName, setContactName] = useState(o.contactName ?? '')
  const [email, setEmail] = useState(o.email ?? '')
  const [phone, setPhone] = useState(o.phone ?? '')
  const [city, setCity] = useState(o.city ?? '')
  const [website, setWebsite] = useState(o.website ?? '')
  const [monthly, setMonthly] = useState(o.monthlyCents ? String(o.monthlyCents / 100) : '')
  const [source, setSource] = useState(o.source ?? '')
  const [categoryId, setCategoryId] = useState(o.categoryId ?? '')

  function submit() {
    if (!businessName.trim()) {
      toast.error('A business name is required.')
      return
    }
    start(async () => {
      const dollars = Number(monthly.replace(/[$,\s]/g, ''))
      const res = await updateOpportunity(o.id, {
        businessName,
        contactName: contactName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        city: city.trim() || null,
        website: website.trim() || null,
        categoryId: categoryId || null,
        source: source || null,
        monthlyCents: Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : 0,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Saved')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            title={
              focus === 'email'
                ? `Add an email address for ${o.businessName}`
                : `Edit ${o.businessName}`
            }
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          />
        }
      >
        {focus === 'email' ? <MailPlus className="size-3" /> : <Pencil className="size-3" />}
        <span className="sr-only">
          {focus === 'email' ? `Add an email address for ${o.businessName}` : `Edit ${o.businessName}`}
        </span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{o.businessName}</DialogTitle>
          <DialogDescription>
            {focus === 'email'
              ? 'No email on file yet. Add one and you can write to them straight from the card.'
              : 'Changes save to the card and the record page together.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Business" className="sm:col-span-2">
            <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </Field>
          <Field label="Contact">
            <Input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              autoFocus={focus !== 'email'}
            />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          </Field>
          <Field label="Email" className="sm:col-span-2">
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              inputMode="email"
              placeholder="owner@business.com"
              autoFocus={focus === 'email'}
            />
          </Field>
          <Field label="City">
            <Input value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
          <Field label="Website">
            <Input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="business.com"
            />
          </Field>
          <Field label="Monthly value">
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
          <Field label="Their category" className="sm:col-span-2">
            <NativeSelect value={categoryId} onChange={setCategoryId} placeholder="Not set">
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  )
}

// Native select, same reasoning as the add dialog: short list, no search needed,
// and it is the control that behaves correctly inside a dialog on a phone.
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

'use client'

import { useState, useTransition } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Category, Territory, Venue } from '@/lib/db.types'
import { saveVenue, type VenueInput } from './actions'

const NO_CATEGORY = 'none'

export function VenueDialog({
  venue,
  categories,
  territories,
  defaultTerritoryId,
}: {
  venue?: Venue
  categories: Category[]
  territories: Territory[]
  defaultTerritoryId: string
}) {
  const isEdit = !!venue
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  const [form, setForm] = useState<VenueInput>({
    id: venue?.id,
    territory_id: venue?.territory_id ?? defaultTerritoryId ?? territories[0]?.id ?? '',
    name: venue?.name ?? '',
    address: venue?.address ?? '',
    lat: venue?.lat ?? null,
    lng: venue?.lng ?? null,
    venue_type: venue?.venue_type ?? '',
    category_id: venue?.category_id ?? null,
    foot_traffic_estimate: venue?.foot_traffic_estimate ?? 0,
    contact_name: venue?.contact_name ?? '',
    contact_email: venue?.contact_email ?? '',
    contact_phone: venue?.contact_phone ?? '',
    status: venue?.status ?? 'active',
  })

  function set<K extends keyof VenueInput>(key: K, value: VenueInput[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.territory_id) {
      toast.error('Name and territory are required.')
      return
    }
    start(async () => {
      const res = await saveVenue(form)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(isEdit ? 'Venue updated' : 'Venue created')
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          isEdit ? (
            <Button variant="ghost" size="icon-sm" aria-label="Edit venue" />
          ) : (
            <Button size="sm" />
          )
        }
      >
        {isEdit ? <Pencil className="size-4" /> : <><Plus className="size-4" /> New venue</>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit venue' : 'New venue'}</DialogTitle>
          <DialogDescription>
            A physical location that hosts a Loop Media screen.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </Field>

          <Field label="Territory">
            <Select value={form.territory_id} onValueChange={(v) => set('territory_id', v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) =>
                    territories.find((t) => t.id === v)?.name ?? 'Select…'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {territories.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Category (business type)">
            <Select
              value={form.category_id ?? NO_CATEGORY}
              onValueChange={(v) => set('category_id', v === NO_CATEGORY ? null : v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) =>
                    v && v !== NO_CATEGORY
                      ? categories.find((c) => c.id === v)?.name ?? '—'
                      : 'None'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>None</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Venue type (label)">
            <Input
              value={form.venue_type}
              onChange={(e) => set('venue_type', e.target.value)}
              placeholder="Sports Bar"
            />
          </Field>

          <Field label="Foot traffic / mo">
            <Input
              type="number"
              min={0}
              value={form.foot_traffic_estimate}
              onChange={(e) => set('foot_traffic_estimate', Number(e.target.value) || 0)}
            />
          </Field>

          <Field label="Address" className="sm:col-span-2">
            <Input
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder="Street, city, state"
            />
            <p className="text-xs text-muted-foreground">
              Map coordinates are filled in automatically from the address.
            </p>
          </Field>

          <Field label="Contact name">
            <Input
              value={form.contact_name}
              onChange={(e) => set('contact_name', e.target.value)}
            />
          </Field>
          <Field label="Contact phone">
            <Input
              value={form.contact_phone}
              onChange={(e) => set('contact_phone', e.target.value)}
            />
          </Field>
          <Field label="Contact email" className="sm:col-span-2">
            <Input
              type="email"
              value={form.contact_email}
              onChange={(e) => set('contact_email', e.target.value)}
            />
          </Field>

          <Field label="Status">
            <Select
              value={form.status}
              onValueChange={(v) => set('status', (v as VenueInput['status']) ?? 'active')}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string | null) => (v === 'inactive' ? 'Inactive' : 'Active')}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <DialogFooter className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create venue'}
            </Button>
          </DialogFooter>
        </form>
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
    <div className={'space-y-1.5 ' + (className ?? '')}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

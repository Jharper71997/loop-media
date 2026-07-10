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
import type { Category, Territory, Venue, PriceTier } from '@/lib/db.types'
import { TIER_LABEL, TIER_PRICE_CENTS, suggestTier, type PricingConfig } from '@/lib/pricing'
import { formatCents } from '@/lib/format'
import { BusinessHoursPicker, type BusinessHoursValue } from '@/components/app/BusinessHoursPicker'
import { defaultHoursValue, hoursValueFromVenue, hoursValueToFields } from '@/lib/openHours'
import { saveVenue, type VenueInput } from './actions'

const NO_CATEGORY = 'none'
const TIERS: PriceTier[] = ['local', 'standard', 'high', 'premium']

const NO_HOST = 'none'

export function VenueDialog({
  venue,
  categories,
  territories,
  hosts,
  defaultTerritoryId,
  pricingConfig,
}: {
  venue?: Venue
  categories: Category[]
  territories: Territory[]
  hosts: { id: string; email: string; full_name: string | null }[]
  defaultTerritoryId: string
  pricingConfig?: PricingConfig
}) {
  const isEdit = !!venue
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  // Tier prices for the dropdown labels — DB config when provided, else defaults.
  const prices = pricingConfig?.tierPriceCents ?? TIER_PRICE_CENTS

  const [form, setForm] = useState<VenueInput>({
    id: venue?.id,
    territory_id: venue?.territory_id ?? defaultTerritoryId ?? territories[0]?.id ?? '',
    name: venue?.name ?? '',
    address: venue?.address ?? '',
    city: venue?.city ?? '',
    state: venue?.state ?? '',
    postal_code: venue?.postal_code ?? '',
    venue_type: venue?.venue_type ?? '',
    category_id: venue?.category_id ?? null,
    host_user_id: venue?.host_user_id ?? null,
    foot_traffic_estimate: venue?.foot_traffic_estimate ?? 0,
    median_daily_customers: venue?.median_daily_customers ?? null,
    price_tier: venue?.price_tier ?? null,
    price_cents_override: venue?.price_cents_override ?? null,
    exclusivity_price_cents: venue?.exclusivity_price_cents ?? null,
    category_slots: venue?.category_slots ?? 1,
    contact_name: venue?.contact_name ?? '',
    contact_email: venue?.contact_email ?? '',
    contact_phone: venue?.contact_phone ?? '',
    status: venue?.status ?? 'active',
    // Seed with the venue's hours (trimmed to HH:MM for the time inputs); new
    // venues default to the same 10:00–22:00 / every-day fallback the filter uses.
    // These single-window columns are overwritten from the per-day `hours` state
    // at submit; kept here only to satisfy the VenueInput shape.
    business_open: (venue?.business_open ?? '10:00').slice(0, 5),
    business_close: (venue?.business_close ?? '22:00').slice(0, 5),
    business_days: venue?.business_days ?? [0, 1, 2, 3, 4, 5, 6],
    business_hours: venue?.business_hours ?? null,
    // New venues get their first screen created alongside them by default.
    create_screen: !venue,
  })

  // Per-day hours live in their own state (the picker owns the 7-day shape); the
  // legacy single-window columns on `form` are overwritten from it at submit.
  const [hours, setHours] = useState<BusinessHoursValue>(() =>
    venue ? hoursValueFromVenue(venue) : defaultHoursValue()
  )

  function set<K extends keyof VenueInput>(key: K, value: VenueInput[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.territory_id) {
      toast.error('Name and territory are required.')
      return
    }
    // A live venue with no foot traffic is hidden from the advertiser map
    // (isVenueListable). Catch it here so "Active" actually shows up — as a
    // coming-soon pin until its screen heartbeats.
    if (form.status === 'active' && (!form.foot_traffic_estimate || form.foot_traffic_estimate <= 0)) {
      toast.error('Set foot traffic above 0 so this venue shows on the advertiser map.')
      return
    }
    if (!hours.days.some((d) => d.isOpen)) {
      toast.error('Pick at least one day the venue is open.')
      return
    }
    start(async () => {
      const res = await saveVenue({ ...form, ...hoursValueToFields(hours) })
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
            A physical location that hosts a Loop Network screen.
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
            <p className="text-xs text-muted-foreground">
              Must be above 0 for the venue to appear on the advertiser map.
            </p>
          </Field>

          <Field label="Typical customers / day">
            <Input
              type="number"
              min={0}
              value={form.median_daily_customers ?? ''}
              onChange={(e) => set('median_daily_customers', Number(e.target.value) || null)}
            />
            <p className="text-xs text-muted-foreground">
              Host-stated daily customers. Drives reach directly; blank falls back to foot traffic / 30.
            </p>
          </Field>

          <Field label="Price tier">
            <Select
              value={form.price_tier ?? 'auto'}
              onValueChange={(v) => set('price_tier', v === 'auto' ? null : (v as PriceTier))}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) =>
                    v && v !== 'auto'
                      ? `${TIER_LABEL[v as PriceTier]} · ${formatCents(prices[v as PriceTier])}/mo`
                      : `Auto (${TIER_LABEL[suggestTier(form.foot_traffic_estimate)]})`}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  Auto from foot traffic ({formatCents(prices[suggestTier(form.foot_traffic_estimate)])}/mo)
                </SelectItem>
                {TIERS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TIER_LABEL[t]} · {formatCents(prices[t])}/mo
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Custom price ($/mo)">
            <Input
              type="number"
              min={0}
              step={1}
              placeholder="Auto from tier"
              value={form.price_cents_override != null ? form.price_cents_override / 100 : ''}
              onChange={(e) => {
                const raw = e.target.value.trim()
                const n = Number(raw)
                set('price_cents_override', raw === '' || Number.isNaN(n) ? null : Math.round(n * 100))
              }}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to use the tier price. A dollar amount overrides the tier for this venue only.
            </p>
          </Field>

          <Field label="Exclusivity price ($/mo)">
            <Input
              type="number"
              min={0}
              step={1}
              placeholder="Network default"
              value={form.exclusivity_price_cents != null ? form.exclusivity_price_cents / 100 : ''}
              onChange={(e) => {
                const raw = e.target.value.trim()
                const n = Number(raw)
                set(
                  'exclusivity_price_cents',
                  raw === '' || Number.isNaN(n) ? null : Math.round(n * 100)
                )
              }}
            />
            <p className="text-xs text-muted-foreground">
              Upcharge for an advertiser to own their category here. Blank uses the network default.
            </p>
          </Field>

          <Field label="Advertisers per category">
            <Input
              type="number"
              min={1}
              value={form.category_slots}
              onChange={(e) => set('category_slots', Math.max(1, Number(e.target.value) || 1))}
            />
            <p className="text-xs text-muted-foreground">
              1 = full exclusivity (one advertiser per category at this venue).
            </p>
          </Field>

          <Field label="Host owner" className="sm:col-span-2">
            <Select
              value={form.host_user_id ?? NO_HOST}
              onValueChange={(v) => set('host_user_id', v === NO_HOST ? null : v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) =>
                    v && v !== NO_HOST
                      ? (() => {
                          const h = hosts.find((x) => x.id === v)
                          return h ? h.full_name ?? h.email : '—'
                        })()
                      : 'Unassigned'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_HOST}>Unassigned</SelectItem>
                {hosts.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.full_name ? `${h.full_name} · ${h.email}` : h.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The host account that owns this venue — they&apos;ll see it on their dashboard.
            </p>
          </Field>

          <Field label="Street address" className="sm:col-span-2">
            <Input
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder="614 Ensign Pl"
            />
            <p className="text-xs text-muted-foreground">
              The map pin is set from the address — no coordinates needed.
            </p>
          </Field>

          <Field label="City">
            <Input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Hebron" />
          </Field>
          <Field label="State / ZIP">
            <div className="flex gap-2">
              <Input
                value={form.state}
                onChange={(e) => set('state', e.target.value.toUpperCase())}
                placeholder="IN"
                maxLength={2}
                className="w-20"
              />
              <Input
                value={form.postal_code}
                onChange={(e) => set('postal_code', e.target.value)}
                placeholder="46341"
              />
            </div>
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

          <div className="space-y-2 sm:col-span-2">
            <Label className="text-xs text-muted-foreground">Business hours</Label>
            <BusinessHoursPicker value={hours} onChange={setHours} />
            <p className="text-xs text-muted-foreground">
              Ad impressions are only counted while the venue is open. Overnight is fine (e.g. a bar
              open 4 PM to 2 AM).
            </p>
          </div>

          {!isEdit && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={!!form.create_screen}
                onChange={(e) => set('create_screen', e.target.checked)}
                className="size-4 accent-primary"
              />
              Also add the first screen (generates a pairing code)
            </label>
          )}

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

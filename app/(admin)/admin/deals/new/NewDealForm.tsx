'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Check, Loader2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Combobox } from '@/components/ui/combobox'
import { Card, CardContent } from '@/components/ui/card'
import { formatCents } from '@/lib/format'
import { quoteCart, type PricingConfig } from '@/lib/pricing'
import {
  CREATIVE_ACCEPT,
  validateCreativeFile,
  riskyVideoNotice,
  readVideoDuration,
  clampSpotSeconds,
} from '@/lib/adCreative'
import type { Category } from '@/lib/db.types'
import { cn } from '@/lib/utils'
import { createAdvertiser, createCreativeUploadUrl, createDeal, type DealBilling } from './actions'
import { attachDealToOpportunity } from '../../pipeline/actions'

export type DealAdvertiser = {
  id: string
  full_name: string | null
  email: string
  category_id: string | null
}

export type DealVenue = {
  id: string
  name: string
  city: string | null
  priceCents: number
  open: number
  totalSlots: number
  screens: number
  ownCategoryName: string | null
  ownCategoryId?: string | null
  runningTitles: string[]
}

type BillingMethod = 'manual' | 'stripe' | 'comp' | 'later'

const today = () => new Date().toISOString().slice(0, 10)
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

export function NewDealForm({
  advertisers,
  categories,
  venues,
  pricingConfig,
  territoryId,
  presetVenueId,
  presetAdvertiserId,
  presetOpportunityId = null,
  presetNewAdvertiser = null,
}: {
  advertisers: DealAdvertiser[]
  categories: Category[]
  venues: DealVenue[]
  pricingConfig: PricingConfig
  territoryId: string
  presetVenueId: string | null
  presetAdvertiserId: string | null
  // Set when this form was opened from a won opportunity. The account does not
  // exist yet, so the form starts on "create new" with their details already in
  // it, and on success the opportunity is linked to the campaign it became.
  presetOpportunityId?: string | null
  presetNewAdvertiser?: { fullName: string; email: string; phone: string } | null
}) {
  const router = useRouter()
  const [saving, startSaving] = useTransition()

  // ---- Advertiser ----
  const [roster, setRoster] = useState(advertisers)
  const [advertiserId, setAdvertiserId] = useState<string | null>(presetAdvertiserId)
  const [creatingNew, setCreatingNew] = useState(!!presetNewAdvertiser)
  const [newAdv, setNewAdv] = useState(
    presetNewAdvertiser ?? { fullName: '', email: '', phone: '' }
  )
  const [advPending, startAdv] = useTransition()
  const advertiser = roster.find((a) => a.id === advertiserId) ?? null

  // ---- The ad ----
  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [qrTarget, setQrTarget] = useState('')
  const [creativeUrl, setCreativeUrl] = useState<string | null>(null)
  const [creativeType, setCreativeType] = useState<'image' | 'video'>('image')
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null)
  const [creativeName, setCreativeName] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [brief, setBrief] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // ---- Locations ----
  const [picked, setPicked] = useState<string[]>(presetVenueId ? [presetVenueId] : [])

  // ---- Billing ----
  const [method, setMethod] = useState<BillingMethod>('manual')
  const [priceOverride, setPriceOverride] = useState<string>('')
  const [checkAmount, setCheckAmount] = useState<string>('')
  const [paidAt, setPaidAt] = useState(today())
  const [paidThrough, setPaidThrough] = useState(plusDays(30))
  const [stripeSubId, setStripeSubId] = useState('')
  const [compUntil, setCompUntil] = useState(plusDays(30))

  // A venue in the advertiser's own line of business can never run their ad —
  // that is the promise made to the host. Greyed out, not hidden, so it's obvious
  // WHY a location isn't available.
  const blockedIds = useMemo(() => {
    if (!categoryId) return new Set<string>()
    return new Set(venues.filter((v) => v.ownCategoryId === categoryId).map((v) => v.id))
  }, [categoryId, venues])

  const selectable = picked.filter((id) => !blockedIds.has(id))

  // Suggested price straight from the pricing engine (volume rungs included), so
  // the number here matches what self-serve would have charged. Editable — a
  // hand-sold deal often isn't rack rate.
  const quote = useMemo(() => {
    const cents = selectable
      .map((id) => venues.find((v) => v.id === id)?.priceCents ?? 0)
      .filter(Boolean)
    return quoteCart(cents, {}, pricingConfig)
  }, [selectable, venues, pricingConfig])

  const monthlyCents =
    priceOverride.trim() === ''
      ? quote.totalCents
      : Math.round(parseFloat(priceOverride.replace(/[^0-9.]/g, '') || '0') * 100)

  async function handleCreateAdvertiser() {
    if (!newAdv.fullName.trim() || !newAdv.email.trim()) {
      toast.error('Business name and email are both needed.')
      return
    }
    startAdv(async () => {
      const res = await createAdvertiser({
        fullName: newAdv.fullName,
        email: newAdv.email,
        phone: newAdv.phone,
        categoryId,
        territoryId,
      })
      if (res.error || !res.id) {
        toast.error(res.error ?? 'Could not create the account.')
        return
      }
      const created: DealAdvertiser = {
        id: res.id,
        full_name: newAdv.fullName.trim(),
        email: newAdv.email.trim().toLowerCase(),
        category_id: categoryId,
      }
      setRoster((r) => [created, ...r.filter((x) => x.id !== created.id)])
      setAdvertiserId(res.id)
      setCreatingNew(false)
      toast.success(`${created.full_name} added.`)
    })
  }

  async function handleUpload(file: File) {
    if (!advertiserId) {
      toast.error('Pick or create the advertiser first — the file is stored under their account.')
      return
    }
    const problem = validateCreativeFile(file)
    if (problem) {
      toast.error(problem)
      return
    }
    const risky = riskyVideoNotice(file)
    if (risky) toast.warning(risky)

    setUploading(true)
    try {
      const isVideo = file.type.startsWith('video/')
      const ext = file.name.split('.').pop() ?? (isVideo ? 'mp4' : 'png')
      const signed = await createCreativeUploadUrl({ advertiserId, ext })
      if (signed.error || !signed.path || !signed.token || !signed.publicUrl) {
        toast.error(signed.error ?? 'Could not start the upload.')
        return
      }
      // Straight to Supabase storage with the signed token — never through the
      // server action, which could not carry a 50 MB video anyway.
      const supabase = createClient()
      const { error } = await supabase.storage
        .from('creatives')
        .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type })
      if (error) {
        toast.error(`Upload failed: ${error.message}`)
        return
      }
      setCreativeUrl(signed.publicUrl)
      setCreativeType(isVideo ? 'video' : 'image')
      setCreativeName(file.name)
      setDurationSeconds(isVideo ? clampSpotSeconds(await readVideoDuration(file)) : null)
      toast.success('Creative uploaded.')
    } finally {
      setUploading(false)
    }
  }

  function submit() {
    if (!advertiserId) return toast.error('Pick an advertiser.')
    if (!title.trim()) return toast.error('Give the ad a title.')
    if (!qrTarget.trim()) return toast.error('Add the scan link the QR points at.')
    if (selectable.length === 0) return toast.error('Pick at least one location.')

    let billing: DealBilling
    if (method === 'stripe') {
      if (!stripeSubId.trim()) return toast.error('Paste the Stripe subscription ID (sub_…).')
      billing = { method: 'stripe', stripeSubscriptionId: stripeSubId }
    } else if (method === 'manual') {
      const amt =
        checkAmount.trim() === ''
          ? monthlyCents
          : Math.round(parseFloat(checkAmount.replace(/[^0-9.]/g, '') || '0') * 100)
      billing = {
        method: 'manual',
        amountCents: amt,
        paidAt: new Date(`${paidAt}T12:00:00Z`).toISOString(),
        paidThrough: new Date(`${paidThrough}T12:00:00Z`).toISOString(),
      }
    } else if (method === 'comp') {
      billing = { method: 'comp', compUntil: new Date(`${compUntil}T12:00:00Z`).toISOString() }
    } else {
      billing = { method: 'later' }
    }

    startSaving(async () => {
      const res = await createDeal({
        advertiserId,
        title,
        categoryId,
        qrTargetUrl: qrTarget,
        creativeUrl,
        creativeType,
        durationSeconds,
        creativeBrief: brief,
        venueIds: selectable,
        monthlyCents,
        billing,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      const bits = [`Placed on ${res.screensPlaced ?? 0} screen${res.screensPlaced === 1 ? '' : 's'}`]
      if (res.needsCreative) bits.push('creative request logged')
      if (res.droppedVenues?.length) bits.push(`${res.droppedVenues.length} location(s) skipped`)
      // Close the loop back to the pipeline card, so the board shows this as won
      // and links to the live account instead of drifting out of date.
      if (presetOpportunityId && res.campaignId) {
        const link = await attachDealToOpportunity(
          presetOpportunityId,
          res.campaignId,
          advertiserId
        )
        if (link.error) bits.push(`pipeline not linked: ${link.error}`)
      }
      toast.success(`Deal created. ${bits.join(' · ')}.`)
      router.push(`/admin/advertisers/${advertiserId}`)
    })
  }

  const advOptions = roster.map((a) => ({
    value: a.id,
    label: a.full_name ? `${a.full_name} · ${a.email}` : a.email,
  }))
  const catOptions = categories.map((c) => ({ value: c.id, label: c.name }))

  return (
    <div className="max-w-3xl space-y-5">
      {/* ---- 1. Who bought ---- */}
      <Step n={1} title="Who bought it" done={!!advertiserId}>
        {!creatingNew ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <Combobox
                  options={advOptions}
                  value={advertiserId}
                  onValueChange={(v) => {
                    setAdvertiserId(v)
                    const found = roster.find((a) => a.id === v)
                    // Reuse the category we already know for them, so host
                    // protection kicks in without re-asking.
                    if (found?.category_id) setCategoryId(found.category_id)
                  }}
                  placeholder="Search advertisers…"
                  searchPlaceholder="Name or email…"
                  emptyText="No advertiser matches."
                />
              </div>
              <Button variant="outline" onClick={() => setCreatingNew(true)}>
                <UserPlus className="size-4" /> New
              </Button>
            </div>
            {advertiser && (
              <p className="text-xs text-muted-foreground">
                {advertiser.email} — they get a real account, so their reports and
                content calendar work like anyone else&apos;s.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Business name">
                <Input
                  value={newAdv.fullName}
                  onChange={(e) => setNewAdv({ ...newAdv, fullName: e.target.value })}
                  placeholder="Joyas Detailing"
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={newAdv.email}
                  onChange={(e) => setNewAdv({ ...newAdv, email: e.target.value })}
                  placeholder="owner@business.com"
                />
              </Field>
              <Field label="Phone (optional)">
                <Input
                  value={newAdv.phone}
                  onChange={(e) => setNewAdv({ ...newAdv, phone: e.target.value })}
                  placeholder="910-555-0134"
                />
              </Field>
              <Field label="Their line of business">
                <Combobox
                  options={catOptions}
                  value={categoryId}
                  onValueChange={setCategoryId}
                  placeholder="Pick a category…"
                />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreateAdvertiser} disabled={advPending}>
                {advPending && <Loader2 className="size-4 animate-spin" />}
                Create account
              </Button>
              <Button variant="ghost" onClick={() => setCreatingNew(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Step>

      {/* ---- 2. The ad ---- */}
      <Step n={2} title="What runs" done={!!title.trim() && !!qrTarget.trim()}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ad title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Nickel Night Fridays"
              />
            </Field>
            <Field label="Their line of business">
              <Combobox
                options={catOptions}
                value={categoryId}
                onValueChange={setCategoryId}
                placeholder="Pick a category…"
              />
            </Field>
          </div>
          <Field
            label="Scan link"
            hint="Where the QR on the ad sends people. Every scan is tracked against this ad."
          >
            <Input
              value={qrTarget}
              onChange={(e) => setQrTarget(e.target.value)}
              placeholder="https://theirsite.com"
            />
          </Field>

          <div className="rounded-lg border border-dashed border-border p-4">
            <input
              ref={fileRef}
              type="file"
              accept={CREATIVE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleUpload(f)
                e.target.value = ''
              }}
            />
            {creativeUrl ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="h-14 w-24 shrink-0 overflow-hidden rounded bg-black">
                  {creativeType === 'video' ? (
                    <video src={creativeUrl} className="h-full w-full object-contain" muted />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={creativeUrl} alt="" className="h-full w-full object-contain" />
                  )}
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-medium">{creativeName}</p>
                  <p className="text-xs text-muted-foreground">
                    {creativeType === 'video' ? `${durationSeconds ?? 15}s video` : 'Image'} · goes
                    on screen approved, no review needed
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  Replace
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading || !advertiserId}
                  >
                    {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                    Upload the creative
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {advertiserId
                      ? 'MP4 (H.264) or an image, under 50 MB.'
                      : 'Pick the advertiser first.'}
                  </span>
                </div>
                <Field
                  label="Or leave it — what should the spot say?"
                  hint="Skips the upload, logs a creative request in Content, and the ad waits until you build it."
                >
                  <Textarea
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    rows={2}
                    placeholder="$4 shots every Thursday, use the photos they texted."
                  />
                </Field>
              </div>
            )}
          </div>
        </div>
      </Step>

      {/* ---- 3. Where it runs ---- */}
      <Step n={3} title="Where it runs" done={selectable.length > 0}>
        <div className="space-y-2">
          {venues.map((v) => {
            const blocked = blockedIds.has(v.id)
            const on = picked.includes(v.id) && !blocked
            const full = v.open === 0
            return (
              <label
                key={v.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                  on ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/40',
                  blocked && 'cursor-not-allowed opacity-50'
                )}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={on}
                  disabled={blocked}
                  onChange={(e) =>
                    setPicked((p) => (e.target.checked ? [...p, v.id] : p.filter((x) => x !== v.id)))
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{v.name}</span>
                    {blocked ? (
                      <Badge variant="warning">Their own category</Badge>
                    ) : full ? (
                      <Badge variant="secondary">Sold out — will queue</Badge>
                    ) : (
                      <Badge variant="outline">{v.open} open</Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {v.city ? `${v.city} · ` : ''}
                    {v.screens} screen{v.screens === 1 ? '' : 's'}
                    {v.runningTitles.length > 0 && ` · running ${v.runningTitles.join(', ')}`}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  {formatCents(v.priceCents)}
                </span>
              </label>
            )
          })}
        </div>
      </Step>

      {/* ---- 4. Billing ---- */}
      <Step n={4} title="How they pay" done>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['manual', 'Check / cash'],
                ['stripe', 'Stripe subscription'],
                ['comp', 'Comped'],
                ['later', 'Bill later'],
              ] as [BillingMethod, string][]
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                  method === m
                    ? 'border-primary bg-primary/10 font-medium text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Monthly price"
              hint={
                selectable.length
                  ? `Rack rate for ${selectable.length} location${selectable.length === 1 ? '' : 's'} is ${formatCents(quote.totalCents)}${quote.discountPct > 0 ? ` (${Math.round(quote.discountPct * 100)}% volume)` : ''}.`
                  : 'Pick locations to see the rate.'
              }
            >
              <Input
                value={priceOverride}
                onChange={(e) => setPriceOverride(e.target.value)}
                placeholder={(quote.totalCents / 100).toFixed(2)}
                inputMode="decimal"
              />
            </Field>

            {method === 'manual' && (
              <>
                <Field label="Amount received" hint="Leave blank to record the full monthly price.">
                  <Input
                    value={checkAmount}
                    onChange={(e) => setCheckAmount(e.target.value)}
                    placeholder={(monthlyCents / 100).toFixed(2)}
                    inputMode="decimal"
                  />
                </Field>
                <Field label="Paid on">
                  <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
                </Field>
                <Field label="Paid through" hint="When you need to chase the next payment.">
                  <Input
                    type="date"
                    value={paidThrough}
                    onChange={(e) => setPaidThrough(e.target.value)}
                  />
                </Field>
              </>
            )}

            {method === 'stripe' && (
              <Field
                label="Stripe subscription ID"
                hint="From whichever Stripe account is billing them — it doesn't have to be this app's."
              >
                <Input
                  value={stripeSubId}
                  onChange={(e) => setStripeSubId(e.target.value)}
                  placeholder="sub_1Abc…"
                />
              </Field>
            )}

            {method === 'comp' && (
              <Field
                label="Free until"
                hint="The nightly cron pulls the ad off screens on this date — you don't have to remember."
              >
                <Input
                  type="date"
                  value={compUntil}
                  onChange={(e) => setCompUntil(e.target.value)}
                />
              </Field>
            )}
          </div>

          {method === 'later' && (
            <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-muted-foreground">
              The ad goes live now and shows on Money as <strong>never billed</strong> until you
              record a payment. It will keep appearing on Today until you do.
            </p>
          )}
        </div>
      </Step>

      {/* ---- Commit ---- */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="text-sm">
            <p className="font-medium">
              {formatCents(monthlyCents)}/mo · {selectable.length} location
              {selectable.length === 1 ? '' : 's'}
            </p>
            <p className="text-xs text-muted-foreground">
              {creativeUrl
                ? 'Goes on air as soon as you save.'
                : 'Saves the account and logs the creative — airs once you upload it.'}
            </p>
          </div>
          <Button onClick={submit} disabled={saving || uploading}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Create the deal
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number
  title: string
  done?: boolean
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="mb-4 flex items-center gap-2.5">
          <span
            className={cn(
              'grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
              done ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            )}
          >
            {done ? <Check className="size-3.5" /> : n}
          </span>
          <h2 className="font-medium">{title}</h2>
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

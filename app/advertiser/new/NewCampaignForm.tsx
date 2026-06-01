'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Upload, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatCents, formatNumber } from '@/lib/format'
import type { Package } from '@/lib/db.types'
import { submitCampaign, type NewCampaignInput } from './actions'

const TIER_RANK: Record<string, number> = { bronze: 0, silver: 1, gold: 2, custom: 3 }
const NO_CATEGORY = 'none'

export type BuilderVenue = {
  id: string
  territoryId: string
  name: string
  categoryId: string | null
  footTraffic: number
  screens: number
  capacity: number
  open: number
}

function customPriceCents(target: number) {
  return Math.max(9900, Math.round(target / 1000) * 500)
}

export function NewCampaignForm({
  userId,
  markets,
  packages,
  categories,
  venues,
}: {
  userId: string
  markets: { id: string; name: string }[]
  packages: Package[]
  categories: { id: string; name: string }[]
  venues: BuilderVenue[]
}) {
  const router = useRouter()
  const sorted = useMemo(
    () => [...packages].sort((a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9)),
    [packages]
  )
  const firstPaid = sorted.find((p) => p.tier !== 'custom') ?? sorted[0]

  const [territoryId, setTerritoryId] = useState(markets[0]?.id ?? '')
  const [packageId, setPackageId] = useState<string>(firstPaid?.id ?? '')
  const [customTarget, setCustomTarget] = useState(50000)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [qrUrl, setQrUrl] = useState('')
  const [mode, setMode] = useState<'upload' | 'help'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [brief, setBrief] = useState('')
  const [placement, setPlacement] = useState<'auto' | 'pick'>('auto')
  const [picked, setPicked] = useState<string[]>([])
  const [pending, start] = useTransition()

  // Venues in the chosen market this advertiser is eligible for — exclusivity
  // hides any venue whose own category matches the advertiser's category.
  const eligibleVenues = useMemo(
    () =>
      venues.filter(
        (v) => v.territoryId === territoryId && !(categoryId && v.categoryId === categoryId)
      ),
    [venues, territoryId, categoryId]
  )
  const eligibleIds = useMemo(() => new Set(eligibleVenues.map((v) => v.id)), [eligibleVenues])
  const pickedEligible = useMemo(() => picked.filter((id) => eligibleIds.has(id)), [picked, eligibleIds])

  function toggleVenue(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const selected = sorted.find((p) => p.id === packageId)
  const isCustom = selected?.tier === 'custom'
  const target = isCustom ? customTarget : selected?.target_impressions ?? 0
  const priceCents = isCustom ? customPriceCents(customTarget) : selected?.base_price_cents ?? 0

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return toast.error('Give your ad a title.')
    if (mode === 'upload' && !file) return toast.error('Upload a creative or switch to "Request help".')
    if (mode === 'help' && !brief.trim()) return toast.error('Describe what you need from our creative team.')
    if (placement === 'pick' && pickedEligible.length === 0)
      return toast.error('Pick at least one screen, or switch to auto-place.')

    start(async () => {
      let creative_url: string | null = null
      let creative_type: 'video' | 'image' | null = null

      if (mode === 'upload' && file) {
        const supabase = createClient()
        const ext = file.name.split('.').pop() ?? 'bin'
        const path = `${userId}/${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await supabase.storage.from('creatives').upload(path, file)
        if (upErr) {
          toast.error(`Upload failed: ${upErr.message}`)
          return
        }
        creative_url = supabase.storage.from('creatives').getPublicUrl(path).data.publicUrl
        creative_type = file.type.startsWith('video') ? 'video' : 'image'
      }

      const input: NewCampaignInput = {
        territory_id: territoryId,
        package_id: isCustom ? null : packageId,
        package_label: isCustom ? `Custom (${formatNumber(target)} imp/mo)` : selected?.name ?? 'Package',
        target_impressions: target,
        category_id: categoryId,
        title,
        qr_target_url: qrUrl.trim() || null,
        creative_type,
        creative_url,
        creative_help_brief: mode === 'help' ? brief : null,
        target_venue_ids: placement === 'pick' ? pickedEligible : null,
      }

      const res = await submitCampaign(input)
      if (res.error) {
        toast.error(res.error)
        return
      }
      if (res.checkoutUrl) {
        window.location.assign(res.checkoutUrl)
        return
      }
      if (res.demo) toast.success('Campaign created (demo mode — no payment).')
      router.push(`/advertiser/campaigns/${res.campaignId}`)
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New campaign</h1>
        <p className="text-sm text-muted-foreground">
          Set a reach goal and we place your ad on the highest-traffic screens.
        </p>
      </div>

      {/* Market */}
      <section className="space-y-2">
        <Label>Market</Label>
        <Select value={territoryId} onValueChange={(v) => setTerritoryId(v ?? '')}>
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue>
              {(v: string | null) => markets.find((m) => m.id === v)?.name ?? 'Select market'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {markets.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      {/* Package */}
      <section className="space-y-3">
        <Label>Choose a plan</Label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {sorted.map((p) => {
            const active = p.id === packageId
            const isC = p.tier === 'custom'
            return (
              <button
                type="button"
                key={p.id}
                onClick={() => setPackageId(p.id)}
                className={cn(
                  'relative rounded-xl border p-4 text-left transition',
                  active ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                )}
              >
                {active && (
                  <Check className="absolute top-3 right-3 size-4 text-primary" />
                )}
                <div className="font-medium">{p.name}</div>
                <div className="mt-1 text-2xl font-semibold">
                  {isC ? 'Flexible' : formatCents(p.base_price_cents)}
                  {!isC && <span className="text-sm font-normal text-muted-foreground">/mo</span>}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {isC
                    ? 'Set your own reach goal'
                    : `${p.screen_cap ?? '—'} screens · ~${formatNumber(p.target_impressions)} imp/mo`}
                </div>
              </button>
            )
          })}
        </div>

        {isCustom && (
          <div className="max-w-xs space-y-1.5 pt-2">
            <Label className="text-xs text-muted-foreground">
              Monthly impression goal
            </Label>
            <Input
              type="number"
              min={1000}
              step={1000}
              value={customTarget}
              onChange={(e) => setCustomTarget(Number(e.target.value) || 0)}
            />
            <p className="text-xs text-muted-foreground">
              Estimated {formatCents(customPriceCents(customTarget))}/mo
            </p>
          </div>
        )}
      </section>

      {/* Ad details */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Ad title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>Your business category</Label>
          <Select
            value={categoryId ?? NO_CATEGORY}
            onValueChange={(v) => setCategoryId(v === NO_CATEGORY ? null : v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string | null) =>
                  v && v !== NO_CATEGORY
                    ? categories.find((c) => c.id === v)?.name ?? '—'
                    : 'Select (for exclusivity)'}
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
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>QR scan destination (optional)</Label>
          <Input
            type="url"
            placeholder="https://your-site.com/offer"
            value={qrUrl}
            onChange={(e) => setQrUrl(e.target.value)}
          />
        </div>
      </section>

      {/* Where it runs */}
      <section className="space-y-3">
        <Label>Where it runs</Label>
        <div className="flex w-fit rounded-md border border-border p-0.5">
          <Button
            type="button"
            size="sm"
            variant={placement === 'auto' ? 'secondary' : 'ghost'}
            onClick={() => setPlacement('auto')}
          >
            Auto-place (recommended)
          </Button>
          <Button
            type="button"
            size="sm"
            variant={placement === 'pick' ? 'secondary' : 'ghost'}
            onClick={() => setPlacement('pick')}
          >
            Pick screens
          </Button>
        </div>

        {placement === 'auto' ? (
          <p className="text-sm text-muted-foreground">
            We place your ad on the highest-traffic screens you&apos;re eligible for until your
            goal is met.
          </p>
        ) : eligibleVenues.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No screens are available to you in this market
            {categoryId ? ' for your category' : ''} yet.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Showing only screens you&apos;re eligible for · {pickedEligible.length} selected
            </p>
            <div className="divide-y divide-border rounded-lg border border-border">
              {eligibleVenues.map((v) => {
                const on = pickedEligible.includes(v.id)
                return (
                  <button
                    type="button"
                    key={v.id}
                    onClick={() => toggleVenue(v.id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition',
                      on ? 'bg-primary/5' : 'hover:bg-accent'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          'grid size-5 shrink-0 place-items-center rounded border',
                          on ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                        )}
                      >
                        {on && <Check className="size-3.5" />}
                      </span>
                      <div>
                        <div className="font-medium">{v.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatNumber(v.footTraffic)} visits/mo · {v.screens} screen
                          {v.screens === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>
                    <Badge
                      variant={v.open > 0 ? 'default' : 'destructive'}
                      className={cn(v.open > 0 && 'bg-emerald-600')}
                    >
                      {v.open > 0 ? `${v.open} open` : 'Full'}
                    </Badge>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {/* Creative */}
      <section className="space-y-3">
        <Label>Your 15-second ad</Label>
        <div className="flex rounded-md border border-border p-0.5 w-fit">
          <Button
            type="button"
            size="sm"
            variant={mode === 'upload' ? 'secondary' : 'ghost'}
            onClick={() => setMode('upload')}
          >
            <Upload className="size-4" /> Upload
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === 'help' ? 'secondary' : 'ghost'}
            onClick={() => setMode('help')}
          >
            <Sparkles className="size-4" /> Request creative help
          </Button>
        </div>

        {mode === 'upload' ? (
          <div className="space-y-2">
            <Input
              type="file"
              accept="image/*,video/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} · {(file.size / 1_000_000).toFixed(1)} MB
              </p>
            )}
          </div>
        ) : (
          <Textarea
            placeholder="Tell us about your business, your offer, colors/logo, and what the ad should say. Our team will design your 15-second spot."
            rows={4}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
          />
        )}
      </section>

      {/* Summary + submit */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
        <div className="text-sm">
          <div className="text-muted-foreground">Goal: {formatNumber(target)} impressions / month</div>
          <div className="text-2xl font-semibold">{formatCents(priceCents)}/mo</div>
        </div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? 'Working…' : 'Continue to payment'}
        </Button>
      </section>
    </form>
  )
}

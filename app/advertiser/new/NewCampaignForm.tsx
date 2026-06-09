'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Upload, Sparkles, Trash2, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button, buttonVariants } from '@/components/ui/button'
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
import { CREATIVE_SETUP_FEE_CENTS, CREATIVE_REFRESH_CENTS } from '@/lib/fees'
import {
  quoteCart,
  TIER_LABEL,
  MIN_MONTHLY_CENTS,
  type PriceTier,
  type QuoteOptions,
} from '@/lib/pricing'
import { CART_KEY } from '../browse/BrowseClient'
import { submitCampaign, type NewCampaignInput } from './actions'

const NO_CATEGORY = 'none'

export type CartVenue = {
  id: string
  territoryId: string
  name: string
  categoryId: string | null
  footTraffic: number
  tier: PriceTier
  priceCents: number
}

export function NewCampaignForm({
  userId,
  categories,
  venues,
  quoteOpts,
}: {
  userId: string
  categories: { id: string; name: string }[]
  venues: CartVenue[]
  quoteOpts?: QuoteOptions
}) {
  const router = useRouter()
  const byId = useMemo(() => new Map(venues.map((v) => [v.id, v])), [venues])

  const [cartIds, setCartIds] = useState<string[]>([])
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [qrUrl, setQrUrl] = useState('')
  const [mode, setMode] = useState<'upload' | 'help'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [brief, setBrief] = useState('')
  const [pending, start] = useTransition()

  // Inherit the cart the advertiser built on the browse map.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CART_KEY)
      if (raw) setCartIds(JSON.parse(raw) as string[])
    } catch {}
  }, [])

  const cart = useMemo(
    () => cartIds.map((id) => byId.get(id)).filter(Boolean) as CartVenue[],
    [cartIds, byId]
  )
  const quote = useMemo(() => quoteCart(cart.map((v) => v.tier), quoteOpts), [cart, quoteOpts])
  const territoryId = cart[0]?.territoryId ?? ''

  function persist(ids: string[]) {
    setCartIds(ids)
    try {
      sessionStorage.setItem(CART_KEY, JSON.stringify(ids))
    } catch {}
  }
  function removeVenue(id: string) {
    persist(cartIds.filter((x) => x !== id))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (cart.length === 0) return toast.error('Your cart is empty. Add screens from the map first.')
    if (!title.trim()) return toast.error('Give your ad a title.')
    if (mode === 'upload' && !file)
      return toast.error('Upload your ad image or switch to "Request creative help".')
    if (mode === 'help' && !brief.trim())
      return toast.error('Tell our team what you need designed.')

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
        venue_ids: cart.map((v) => v.id),
        category_id: categoryId,
        title,
        qr_target_url: qrUrl.trim() || null,
        creative_type,
        creative_url,
        creative_help_brief: mode === 'help' ? brief : null,
      }

      const res = await submitCampaign(input)
      if (res.error) {
        toast.error(res.error)
        return
      }
      try {
        sessionStorage.removeItem(CART_KEY)
      } catch {}
      if (res.checkoutUrl) {
        window.location.assign(res.checkoutUrl)
        return
      }
      if (res.demo) toast.success('Campaign created (demo mode — no payment).')
      router.push(`/advertiser/campaigns/${res.campaignId}`)
    })
  }

  if (cart.length === 0) {
    return (
      <div className="space-y-4 py-10 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Your cart is empty</h1>
        <p className="text-sm text-muted-foreground">
          Head to the map and tap the businesses you want a screen in.
        </p>
        <Link href="/advertiser/browse" className={buttonVariants({ size: 'lg' })}>
          Browse screens
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <div>
        <Link
          href="/advertiser/browse"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to map
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Review &amp; launch</h1>
        <p className="text-sm text-muted-foreground">
          Your cart, your creative, then you&apos;re live on every screen you picked.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        {/* Left: ad details */}
        <div className="space-y-8">
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

          <section className="space-y-3">
            <Label>Your 15-second ad</Label>
            <p className="text-xs text-muted-foreground">
              Image ads run best at 1180 × 820. Up to 20 ads share a 5-minute loop.
            </p>
            <div className="flex w-fit rounded-md border border-border p-0.5">
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
        </div>

        {/* Right: cart summary */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-4 py-3 text-sm font-medium">
              {cart.length} screen{cart.length === 1 ? '' : 's'} in your cart
            </div>
            <ul className="max-h-72 divide-y divide-border overflow-auto">
              {cart.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{v.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {TIER_LABEL[v.tier]} · {formatNumber(v.footTraffic)}/mo
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm tabular-nums">{formatCents(v.priceCents)}</span>
                    <button
                      type="button"
                      onClick={() => removeVenue(v.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${v.name}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="space-y-1.5 border-t border-border px-4 py-3 text-sm">
              <Row label="Subtotal" value={formatCents(quote.listCents)} />
              {quote.freeScreens > 0 && (
                <Row
                  label={`Free screens (${quote.freeScreens})`}
                  value={`-${formatCents(quote.listCents - quote.subtotalCents)}`}
                  good
                />
              )}
              {quote.discountPct > 0 && (
                <Row
                  label={`Discount (${Math.round(quote.discountPct * 100)}%${quote.hostPct > 0 ? ', incl. host' : ''})`}
                  value={`-${formatCents(quote.subtotalCents - quote.discountedCents)}`}
                  good
                />
              )}
              {quote.floorApplied && (
                <Row
                  label="Account minimum"
                  value={`$${(MIN_MONTHLY_CENTS / 100).toFixed(0)}`}
                  muted
                />
              )}
              {mode === 'help' && (
                <Row label="Creative refresh" value={`${formatCents(CREATIVE_REFRESH_CENTS)}`} muted />
              )}
              <div className="flex items-center justify-between border-t border-border pt-2 text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">
                  {formatCents(quote.totalCents + (mode === 'help' ? CREATIVE_REFRESH_CENTS : 0))}/mo
                </span>
              </div>
              {mode === 'help' && (
                <p className="text-[11px] text-muted-foreground">
                  + {formatCents(CREATIVE_SETUP_FEE_CENTS)} one-time creative setup
                </p>
              )}
            </div>
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? 'Working…' : 'Continue to payment'}
          </Button>
        </aside>
      </div>
    </form>
  )
}

function Row({
  label,
  value,
  good,
  muted,
}: {
  label: string
  value: string
  good?: boolean
  muted?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? 'text-muted-foreground' : ''}>{label}</span>
      <span className={good ? 'text-emerald-600 tabular-nums' : 'tabular-nums'}>{value}</span>
    </div>
  )
}

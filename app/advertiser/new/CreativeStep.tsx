'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Upload, Sparkles, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { buttonVariants } from '@/components/ui/button'
import { Button } from '@/components/ui/button'
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
import { StepHeader } from '@/components/app/StepHeader'
import { StickyCta } from '@/components/app/StickyCta'
import { formatCents } from '@/lib/format'
import { CREATIVE_SETUP_FEE_CENTS, CREATIVE_REFRESH_CENTS } from '@/lib/fees'
import { quoteCart, type QuoteOptions } from '@/lib/pricing'
import { CART_KEY } from '../browse/BrowseClient'
import { submitCampaign, type NewCampaignInput } from './actions'
import type { CartVenue } from './types'

const NO_CATEGORY = 'none'

export function CreativeStep({
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
  const totalWithCreative = quote.totalCents + (mode === 'help' ? CREATIVE_REFRESH_CENTS : 0)

  function onSubmit() {
    if (cart.length === 0) return toast.error('Your cart is empty. Pick screens first.')
    if (!title.trim()) return toast.error('Give your ad a title.')
    if (mode === 'upload' && !file)
      return toast.error('Upload your ad image or switch to "Request creative help".')
    if (mode === 'help' && !brief.trim()) return toast.error('Tell our team what you need designed.')

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
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <h1 className="font-heading text-xl font-bold">Your cart is empty</h1>
        <Link href="/advertiser/browse" className={buttonVariants({ size: 'lg' })}>
          <MapPin className="size-4" /> Pick screens
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <StepHeader
        step={4}
        total={4}
        title="Add your ad"
        subtitle="A 15-second spot. Image ads look best at 1180 × 820."
      />

      <div className="space-y-1.5">
        <Label>Ad title</Label>
        <Input className="h-11" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>

      <div className="space-y-1.5">
        <Label>Your business category</Label>
        <Select
          value={categoryId ?? NO_CATEGORY}
          onValueChange={(v) => setCategoryId(v === NO_CATEGORY ? null : v)}
        >
          <SelectTrigger className="h-11 w-full">
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

      <div className="space-y-1.5">
        <Label>Link when scanned (optional)</Label>
        <Input
          type="url"
          className="h-11"
          placeholder="https://your-site.com/offer"
          value={qrUrl}
          onChange={(e) => setQrUrl(e.target.value)}
        />
      </div>

      <div className="space-y-3">
        <Label>Your creative</Label>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={mode === 'upload' ? 'secondary' : 'outline'}
            className="h-11"
            onClick={() => setMode('upload')}
          >
            <Upload className="size-4" /> Upload
          </Button>
          <Button
            type="button"
            variant={mode === 'help' ? 'secondary' : 'outline'}
            className="h-11"
            onClick={() => setMode('help')}
          >
            <Sparkles className="size-4" /> Make it for me
          </Button>
        </div>

        {mode === 'upload' ? (
          <div className="space-y-2">
            <Input
              type="file"
              accept="image/*,video/*"
              className="h-11"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} · {(file.size / 1_000_000).toFixed(1)} MB
              </p>
            )}
          </div>
        ) : (
          <>
            <Textarea
              placeholder="Tell us about your business, your offer, colors/logo, and what the ad should say. Our team designs your 15-second spot."
              rows={4}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              + {formatCents(CREATIVE_REFRESH_CENTS)}/mo, plus {formatCents(CREATIVE_SETUP_FEE_CENTS)}{' '}
              one-time setup.
            </p>
          </>
        )}
      </div>

      <StickyCta
        label={pending ? 'Working…' : 'Continue to payment'}
        disabled={pending}
        onClick={onSubmit}
        priceTop="Total"
        priceMain={`${formatCents(totalWithCreative)}/mo`}
      />
    </div>
  )
}

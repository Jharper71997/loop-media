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
import { StepHeader } from '@/components/app/StepHeader'
import { StickyCta } from '@/components/app/StickyCta'
import { CreativeFitNotice } from '@/components/app/CreativeFitNotice'
import { useBasePath } from '@/lib/useBasePath'
import { formatCents } from '@/lib/format'
import { CREATIVE_SETUP_FEE_CENTS, CREATIVE_REFRESH_CENTS } from '@/lib/fees'
import { quoteCart, type QuoteOptions, type PricingConfig } from '@/lib/pricing'
import { CART_KEY } from '../browse/BrowseClient'
import { submitCampaign, type NewCampaignInput } from './actions'
import type { CartVenue } from './types'
import { cn } from '@/lib/utils'
import type { QrPosition } from '@/lib/db.types'

const QR_POSITIONS: { value: QrPosition; label: string }[] = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
]

// Where the QR sits in the upload preview (smaller insets than the TV overlay).
const QR_PREVIEW_CORNER: Record<QrPosition, string> = {
  'top-left': 'left-2 top-2',
  'top-right': 'right-2 top-2',
  'bottom-left': 'left-2 bottom-2',
  'bottom-right': 'right-2 bottom-2',
}

export function CreativeStep({
  userId,
  categories,
  defaultCategoryId,
  venues,
  quoteOpts,
  pricingConfig,
}: {
  userId: string
  categories: { id: string; name: string }[]
  defaultCategoryId?: string | null
  venues: CartVenue[]
  quoteOpts?: QuoteOptions
  pricingConfig?: PricingConfig
}) {
  const router = useRouter()
  const base = useBasePath()
  const byId = useMemo(() => new Map(venues.map((v) => [v.id, v])), [venues])

  const [cartIds, setCartIds] = useState<string[]>([])
  // Reuse the line of business they already picked in browse Step 1 (saved on
  // their profile) — we don't re-ask the category here.
  const categoryId = defaultCategoryId ?? null
  const categoryName = categoryId ? categories.find((c) => c.id === categoryId)?.name : null
  const [title, setTitle] = useState('')
  const [qrUrl, setQrUrl] = useState('')
  const [mode, setMode] = useState<'upload' | 'help'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [qrPosition, setQrPosition] = useState<QrPosition>('bottom-right')
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [qrPreview, setQrPreview] = useState<string | null>(null)
  const [brief, setBrief] = useState('')
  const [pending, start] = useTransition()

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CART_KEY)
      if (raw) setCartIds(JSON.parse(raw) as string[])
    } catch {}
  }, [])

  // Local object URL for the chosen file, so we can preview it (revoked on change).
  useEffect(() => {
    if (!file) {
      setFileUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setFileUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Render the actual scan-link QR client-side so the preview matches the TV.
  // Lazy-import keeps the qrcode lib out of the main bundle.
  useEffect(() => {
    const url = qrUrl.trim()
    if (!url) {
      setQrPreview(null)
      return
    }
    let alive = true
    import('qrcode')
      .then(({ default: QR }) =>
        QR.toDataURL(url, { margin: 1, width: 240, color: { dark: '#000000', light: '#ffffff' } })
      )
      .then((data) => {
        if (alive) setQrPreview(data)
      })
      .catch(() => {
        if (alive) setQrPreview(null)
      })
    return () => {
      alive = false
    }
  }, [qrUrl])

  const cart = useMemo(
    () => cartIds.map((id) => byId.get(id)).filter(Boolean) as CartVenue[],
    [cartIds, byId]
  )
  const quote = useMemo(
    () => quoteCart(cart.map((v) => v.tier), quoteOpts, pricingConfig),
    [cart, quoteOpts, pricingConfig]
  )
  const territoryId = cart[0]?.territoryId ?? ''
  const totalWithCreative = quote.totalCents + (mode === 'help' ? CREATIVE_REFRESH_CENTS : 0)

  function onSubmit() {
    if (cart.length === 0) return toast.error('Your cart is empty. Pick screens first.')
    if (!title.trim()) return toast.error('Give your ad a title.')
    if (!qrUrl.trim()) return toast.error('Add the link people go to when they scan your ad.')
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
        qr_target_url: qrUrl.trim(),
        qr_position: qrPosition,
        creative_type,
        creative_url,
        creative_help_brief: mode === 'help' ? brief : null,
        base_path: base,
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
      router.push(`${base}/campaigns/${res.campaignId}`)
    })
  }

  if (cart.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <h1 className="font-heading text-xl font-bold">Your cart is empty</h1>
        <Link href={`${base}/browse`} className={buttonVariants({ size: 'lg' })}>
          <MapPin className="size-4" /> Pick screens
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <StepHeader
        step={3}
        total={3}
        title="Add your ad"
        subtitle="A 15-second spot. Image ads look best at 1180 × 820."
      />

      <div className="space-y-1.5">
        <Label>Ad title</Label>
        <Input className="h-11" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>

      {categoryName && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Category (locked for exclusivity)</span>
          <span className="font-medium">{categoryName}</span>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Link when scanned</Label>
        <Input
          type="url"
          className="h-11"
          placeholder="https://your-site.com/offer"
          value={qrUrl}
          onChange={(e) => setQrUrl(e.target.value)}
          required
        />
        <p className="text-xs text-muted-foreground">
          A QR code on your ad sends scanners here. This is how you track results.
        </p>
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
            <CreativeFitNotice file={file} />

            {file && fileUrl && (
              <div className="space-y-3 pt-1">
                <p className="text-xs text-muted-foreground">
                  Preview — this is how your ad shows on screen.
                </p>
                <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
                  {file.type.startsWith('video') ? (
                    <video
                      src={fileUrl}
                      className="h-full w-full object-contain"
                      muted
                      autoPlay
                      loop
                      playsInline
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileUrl} alt="Ad preview" className="h-full w-full object-contain" />
                  )}
                  {qrUrl.trim() && (
                    <div
                      className={cn(
                        'absolute rounded-md bg-white p-1 ring-2 ring-[#d4af37]',
                        QR_PREVIEW_CORNER[qrPosition]
                      )}
                    >
                      {qrPreview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={qrPreview} alt="QR preview" className="size-12 rounded-sm" />
                      ) : (
                        <div className="size-12 rounded-sm bg-muted" />
                      )}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>QR code position</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {QR_POSITIONS.map((p) => (
                      <Button
                        key={p.value}
                        type="button"
                        variant={qrPosition === p.value ? 'secondary' : 'outline'}
                        className="h-10"
                        onClick={() => setQrPosition(p.value)}
                      >
                        {p.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
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

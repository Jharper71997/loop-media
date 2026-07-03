'use client'

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from 'react'
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

// The exported creative is always rendered at 16:9 720p so the crop preview and
// the offscreen-canvas export share one coordinate system (see computeDraw).
const EXPORT_W = 1280
const EXPORT_H = 720

// Free-drag QR default — the QR CENTER as fractions of the frame. Roughly
// bottom-right, matching the old 'bottom-right' corner so placements don't jump.
const QR_DEFAULT = { x: 0.9, y: 0.88 }

// Filter presets are plain CSS filter strings. The SAME string is set on the
// preview <img> (style.filter) and on the export canvas (ctx.filter), so what the
// advertiser sees is what gets baked into the uploaded PNG.
const FILTER_PRESETS = [
  { value: 'none', label: 'None', css: '' },
  { value: 'warm', label: 'Warm', css: 'sepia(0.35) saturate(1.25) hue-rotate(-12deg)' },
  { value: 'bw', label: 'B&W', css: 'grayscale(1)' },
  { value: 'vivid', label: 'Vivid', css: 'saturate(1.6) contrast(1.08)' },
] as const
type FilterPreset = (typeof FILTER_PRESETS)[number]['value']

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function buildFilter(preset: FilterPreset, brightness: number, contrast: number): string {
  const base = FILTER_PRESETS.find((p) => p.value === preset)?.css ?? ''
  return `${base} brightness(${brightness}%) contrast(${contrast}%)`.trim()
}

// Cover-fit the natural image into the WxH frame, then zoom about center and pan.
// Returns the draw rect in frame pixels — used for BOTH the CSS preview (as % of
// the frame) and the canvas export, so they line up exactly.
function computeDraw(
  nat: { w: number; h: number },
  zoom: number,
  pan: { x: number; y: number },
  W: number,
  H: number
) {
  const base = Math.max(W / nat.w, H / nat.h) // cover
  const s = base * zoom
  const dw = nat.w * s
  const dh = nat.h * s
  const dx = (W - dw) / 2 + pan.x * W
  const dy = (H - dh) / 2 + pan.y * H
  return { dx, dy, dw, dh }
}

// Keep the (zoomed) image fully covering the frame: pan is bounded by how much
// the drawn image overhangs each edge (as a fraction of the frame).
function clampPan(
  nat: { w: number; h: number },
  zoom: number,
  pan: { x: number; y: number },
  W: number,
  H: number
) {
  const base = Math.max(W / nat.w, H / nat.h)
  const s = base * zoom
  const maxX = Math.max(0, (nat.w * s - W) / (2 * W))
  const maxY = Math.max(0, (nat.h * s - H) / (2 * H))
  return { x: clamp(pan.x, -maxX, maxX), y: clamp(pan.y, -maxY, maxY) }
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
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [qrPreview, setQrPreview] = useState<string | null>(null)
  const [brief, setBrief] = useState('')
  const [pending, start] = useTransition()

  // Free-drag QR center (fractions of the frame).
  const [qrX, setQrX] = useState(QR_DEFAULT.x)
  const [qrY, setQrY] = useState(QR_DEFAULT.y)

  // Photo editor (images only). nat = natural pixel size once the image loads.
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  const [preset, setPreset] = useState<FilterPreset>('none')

  const frameRef = useRef<HTMLDivElement>(null)
  const qrChipRef = useRef<HTMLDivElement>(null)
  const qrDragRef = useRef(false)
  const panDragRef = useRef<{ px: number; py: number; panX: number; panY: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isVideo = !!file && file.type.startsWith('video')
  const filterStr = buildFilter(preset, brightness, contrast)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CART_KEY)
      if (raw) setCartIds(JSON.parse(raw) as string[])
    } catch {}
  }, [])

  // Local object URL for the chosen file, so we can preview it (revoked on
  // change). Also resets the photo editor whenever the file changes.
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setBrightness(100)
    setContrast(100)
    setPreset('none')
    setNat(null)
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
    () => quoteCart(cart.map((v) => v.priceCents), quoteOpts, pricingConfig),
    [cart, quoteOpts, pricingConfig]
  )
  const territoryId = cart[0]?.territoryId ?? ''
  const totalWithCreative = quote.totalCents + (mode === 'help' ? CREATIVE_REFRESH_CENTS : 0)

  // Drag the QR chip anywhere; clamp so the whole chip stays inside the frame.
  function onQrDown(e: React.PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    qrDragRef.current = true
  }
  function onQrMove(e: React.PointerEvent) {
    if (!qrDragRef.current) return
    const frame = frameRef.current
    if (!frame) return
    const r = frame.getBoundingClientRect()
    const chip = qrChipRef.current
    const halfW = chip ? chip.offsetWidth / 2 / r.width : 0.06
    const halfH = chip ? chip.offsetHeight / 2 / r.height : 0.06
    setQrX(clamp((e.clientX - r.left) / r.width, halfW, 1 - halfW))
    setQrY(clamp((e.clientY - r.top) / r.height, halfH, 1 - halfH))
  }
  function onQrUp(e: React.PointerEvent) {
    qrDragRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}
  }

  // Drag the photo to pan (images only); offsets are fractions of the frame.
  function onPanDown(e: React.PointerEvent) {
    if (!nat) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    panDragRef.current = { px: e.clientX, py: e.clientY, panX: pan.x, panY: pan.y }
  }
  function onPanMove(e: React.PointerEvent) {
    const d = panDragRef.current
    if (!d || !nat) return
    const frame = frameRef.current
    if (!frame) return
    const r = frame.getBoundingClientRect()
    const nx = d.panX + (e.clientX - d.px) / r.width
    const ny = d.panY + (e.clientY - d.py) / r.height
    setPan(clampPan(nat, zoom, { x: nx, y: ny }, EXPORT_W, EXPORT_H))
  }
  function onPanUp(e: React.PointerEvent) {
    panDragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}
  }

  function onZoomChange(z: number) {
    setZoom(z)
    if (nat) setPan((p) => clampPan(nat, z, p, EXPORT_W, EXPORT_H))
  }

  // Inline style that places the photo in the frame using the SAME math as the
  // canvas export (expressed as % of the frame). maxWidth:none lets zoom > 1
  // overflow past the frame width (clipped by the container's overflow-hidden).
  const draw = nat ? computeDraw(nat, zoom, pan, EXPORT_W, EXPORT_H) : null
  const imgStyle: CSSProperties = draw
    ? {
        position: 'absolute',
        left: `${(draw.dx / EXPORT_W) * 100}%`,
        top: `${(draw.dy / EXPORT_H) * 100}%`,
        width: `${(draw.dw / EXPORT_W) * 100}%`,
        height: `${(draw.dh / EXPORT_H) * 100}%`,
        maxWidth: 'none',
        filter: filterStr,
      }
    : { position: 'absolute', inset: 0, width: '100%', height: '100%', filter: filterStr }

  // Composite the cropped + filtered photo to a 1280x720 PNG. The QR is NEVER
  // baked in (the TV draws a tracked QR at play time) — only the photo is drawn.
  async function exportImageBlob(src: string): Promise<Blob> {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new window.Image()
      im.onload = () => res(im)
      im.onerror = () => rej(new Error('Could not read image.'))
      im.src = src
    })
    const dims = { w: img.naturalWidth, h: img.naturalHeight }
    const canvas = document.createElement('canvas')
    canvas.width = EXPORT_W
    canvas.height = EXPORT_H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not available.')
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, EXPORT_W, EXPORT_H)
    ctx.filter = filterStr // same string as the preview img
    const d = computeDraw(dims, zoom, pan, EXPORT_W, EXPORT_H)
    ctx.drawImage(img, d.dx, d.dy, d.dw, d.dh)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
    if (!blob) throw new Error('Could not render image.')
    return blob
  }

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
        // Images are composited (crop + zoom + pan + filter) to a PNG and that is
        // uploaded; videos upload raw. The QR stays a render-time overlay either way.
        let blob: Blob = file
        let ext = file.name.split('.').pop() ?? 'bin'
        let contentType = file.type
        if (!isVideo && fileUrl) {
          try {
            blob = await exportImageBlob(fileUrl)
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not process image.')
            return
          }
          ext = 'png'
          contentType = 'image/png'
        }
        const path = `${userId}/${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('creatives')
          .upload(path, blob, { contentType })
        if (upErr) {
          toast.error(`Upload failed: ${upErr.message}`)
          return
        }
        creative_url = supabase.storage.from('creatives').getPublicUrl(path).data.publicUrl
        creative_type = isVideo ? 'video' : 'image'
      }

      const input: NewCampaignInput = {
        territory_id: territoryId,
        venue_ids: cart.map((v) => v.id),
        category_id: categoryId,
        title,
        qr_target_url: qrUrl.trim(),
        qr_x: qrX,
        qr_y: qrY,
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
            onClick={() => {
              // First press picks the Upload mode (revealing the dropzone below);
              // pressing it again once you're in upload mode opens the file picker,
              // so a tap on the button that literally says "Upload" always does
              // something useful instead of silently just highlighting.
              if (mode !== 'upload') setMode('upload')
              else fileInputRef.current?.click()
            }}
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
            <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center transition hover:border-primary/50">
              <Upload className="size-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {file ? file.name : 'Tap to upload an image or video'}
              </span>
              {file && (
                <span className="text-xs text-muted-foreground">
                  {(file.size / 1_000_000).toFixed(1)} MB · tap to replace
                </span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <CreativeFitNotice file={file} />

            {file && fileUrl && (
              <div className="space-y-3 pt-1">
                <p className="text-xs text-muted-foreground">
                  Preview — this is how your ad shows on screen. Drag the code anywhere
                  {!isVideo ? ', and drag the photo to reposition it' : ''}.
                </p>
                <div
                  ref={frameRef}
                  className="relative aspect-video w-full touch-none overflow-hidden rounded-lg bg-black select-none"
                >
                  {isVideo ? (
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
                    <img
                      src={fileUrl}
                      alt="Ad preview"
                      draggable={false}
                      onLoad={(e) =>
                        setNat({
                          w: e.currentTarget.naturalWidth,
                          h: e.currentTarget.naturalHeight,
                        })
                      }
                      onPointerDown={onPanDown}
                      onPointerMove={onPanMove}
                      onPointerUp={onPanUp}
                      onPointerCancel={onPanUp}
                      className="cursor-grab touch-none select-none active:cursor-grabbing"
                      style={imgStyle}
                    />
                  )}
                  {qrUrl.trim() && (
                    <div
                      ref={qrChipRef}
                      onPointerDown={onQrDown}
                      onPointerMove={onQrMove}
                      onPointerUp={onQrUp}
                      onPointerCancel={onQrUp}
                      className="absolute cursor-grab touch-none rounded-md bg-white p-1 ring-2 ring-[#d4af37] active:cursor-grabbing"
                      style={{
                        left: `${qrX * 100}%`,
                        top: `${qrY * 100}%`,
                        transform: 'translate(-50%, -50%)',
                      }}
                    >
                      {qrPreview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={qrPreview}
                          alt="QR preview"
                          draggable={false}
                          className="size-12 rounded-sm"
                        />
                      ) : (
                        <div className="size-12 rounded-sm bg-muted" />
                      )}
                    </div>
                  )}
                </div>

                {!isVideo && (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label>Zoom</Label>
                        <span className="text-xs text-muted-foreground">{zoom.toFixed(1)}×</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={3}
                        step={0.01}
                        value={zoom}
                        onChange={(e) => onZoomChange(Number(e.target.value))}
                        className="h-2 w-full cursor-pointer accent-primary"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label>Brightness</Label>
                          <span className="text-xs text-muted-foreground">{brightness}%</span>
                        </div>
                        <input
                          type="range"
                          min={50}
                          max={150}
                          step={1}
                          value={brightness}
                          onChange={(e) => setBrightness(Number(e.target.value))}
                          className="h-2 w-full cursor-pointer accent-primary"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label>Contrast</Label>
                          <span className="text-xs text-muted-foreground">{contrast}%</span>
                        </div>
                        <input
                          type="range"
                          min={50}
                          max={150}
                          step={1}
                          value={contrast}
                          onChange={(e) => setContrast(Number(e.target.value))}
                          className="h-2 w-full cursor-pointer accent-primary"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Filter</Label>
                      <div className="grid grid-cols-4 gap-2">
                        {FILTER_PRESETS.map((p) => (
                          <Button
                            key={p.value}
                            type="button"
                            variant={preset === p.value ? 'secondary' : 'outline'}
                            className="h-10"
                            onClick={() => setPreset(p.value)}
                          >
                            {p.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
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

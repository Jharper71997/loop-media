'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Cropper, { type Area, type Point } from 'react-easy-crop'
import { Upload, Sparkles, MapPin, SlidersHorizontal, ChevronDown, RotateCw } from 'lucide-react'
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
import {
  QR_DEFAULT,
  QR_SIZE_DEFAULT,
  QR_SIZE_MIN,
  QR_SIZE_MAX,
  FILTER_PRESETS,
  clamp,
  buildFilter,
  getCroppedImg,
  validateCreativeFile,
  CREATIVE_ACCEPT,
  type FilterPreset,
} from '@/lib/adCreative'
import { CART_KEY } from '../browse/BrowseClient'
import { submitCampaign, type NewCampaignInput } from './actions'
import { EXCL_KEY, type CartVenue } from './types'

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
  const [exclIds, setExclIds] = useState<string[]>([])
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

  // Free-drag QR center (fractions of the frame) + QR width (fraction of frame width).
  const [qrX, setQrX] = useState(QR_DEFAULT.x)
  const [qrY, setQrY] = useState(QR_DEFAULT.y)
  const [qrSize, setQrSize] = useState(QR_SIZE_DEFAULT)

  // Photo editor (images only) — react-easy-crop drives crop/zoom/rotation, so the
  // advertiser gets pinch + scroll zoom, rotate, and smooth drag on any device.
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  const [preset, setPreset] = useState<FilterPreset>('none')
  // Photo adjustments are collapsed by default so the common path is just
  // upload → position the QR → continue, not a wall of sliders.
  const [showAdjust, setShowAdjust] = useState(false)
  // Drives the submit button copy so a slow phone upload doesn't read as frozen.
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  // Highlights the dropzone while a file is dragged over it (desktop drag-and-drop).
  const [dragActive, setDragActive] = useState(false)

  const frameRef = useRef<HTMLDivElement>(null)
  const qrChipRef = useRef<HTMLDivElement>(null)
  const qrDragRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isVideo = !!file && file.type.startsWith('video')
  const filterStr = buildFilter(preset, brightness, contrast)

  // Validate a chosen creative before accepting it (web-safe video, size cap) so a
  // file that would silently fail on the TV is rejected here with a clear reason.
  function pickFile(f: File | null) {
    if (!f) return setFile(null)
    const err = validateCreativeFile(f)
    if (err) return toast.error(err)
    setFile(f)
  }

  // The scan destination: the typed website URL.
  const qrTarget = useMemo(() => qrUrl.trim(), [qrUrl])

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CART_KEY)
      if (raw) setCartIds(JSON.parse(raw) as string[])
      const rawExcl = sessionStorage.getItem(EXCL_KEY)
      if (rawExcl) setExclIds(JSON.parse(rawExcl) as string[])
    } catch {}
  }, [])

  // Local object URL for the chosen file, so we can preview it (revoked on
  // change). Also resets the photo editor whenever the file changes.
  useEffect(() => {
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setRotation(0)
    setCroppedAreaPixels(null)
    setBrightness(100)
    setContrast(100)
    setPreset('none')
    setShowAdjust(false)
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
    const url = qrTarget
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
  }, [qrTarget])

  const cart = useMemo(
    () => cartIds.map((id) => byId.get(id)).filter(Boolean) as CartVenue[],
    [cartIds, byId]
  )
  const quote = useMemo(
    () => quoteCart(cart.map((v) => v.priceCents), quoteOpts, pricingConfig),
    [cart, quoteOpts, pricingConfig]
  )
  const territoryId = cart[0]?.territoryId ?? ''
  // Exclusivity, reconciled with the current cart + availability (matches ReviewStep).
  const exclSet = useMemo(() => {
    const inCart = new Set(cart.filter((v) => v.exclusivityAvailable).map((v) => v.id))
    return new Set(exclIds.filter((id) => inCart.has(id)))
  }, [exclIds, cart])
  const exclusivityCents = useMemo(
    () => cart.reduce((s, v) => s + (exclSet.has(v.id) ? v.exclusivityCents : 0), 0),
    [cart, exclSet]
  )
  const totalWithCreative =
    quote.totalCents + exclusivityCents + (mode === 'help' ? CREATIVE_REFRESH_CENTS : 0)

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

  // Quarter-turn for phone photos that come in sideways (stays within the slider's range).
  function rotate90() {
    setRotation((r) => {
      const n = r + 90
      return n > 180 ? n - 360 : n
    })
  }

  function onSubmit() {
    if (cart.length === 0) return toast.error('Your cart is empty. Pick screens first.')
    if (!title.trim()) return toast.error('Give your ad a title.')
    if (!qrTarget)
      return toast.error('Add the link people go to when they scan your ad.')
    if (mode === 'upload' && !file)
      return toast.error('Upload your ad image or switch to "Request creative help".')
    if (mode === 'help' && !brief.trim()) return toast.error('Tell our team what you need designed.')

    start(async () => {
      setStatusMsg(null)
      let creative_url: string | null = null
      let creative_type: 'video' | 'image' | null = null

      if (mode === 'upload' && file) {
        const supabase = createClient()
        // Images are composited (crop + zoom + rotation + filter) to a PNG and that is
        // uploaded; videos upload raw. The QR stays a render-time overlay either way.
        let blob: Blob = file
        let ext = file.name.split('.').pop() ?? 'bin'
        let contentType = file.type
        if (!isVideo && fileUrl) {
          if (!croppedAreaPixels) {
            toast.error('Give the image a moment to finish loading, then try again.')
            return
          }
          try {
            blob = await getCroppedImg(fileUrl, croppedAreaPixels, rotation, filterStr)
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not process image.')
            return
          }
          ext = 'png'
          contentType = 'image/png'
        }
        setStatusMsg('Uploading your ad…')
        const path = `${userId}/${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('creatives')
          .upload(path, blob, { contentType })
        if (upErr) {
          setStatusMsg(null)
          toast.error(`Upload failed: ${upErr.message}`)
          return
        }
        creative_url = supabase.storage.from('creatives').getPublicUrl(path).data.publicUrl
        creative_type = isVideo ? 'video' : 'image'
      }

      setStatusMsg('Setting up your campaign…')

      const input: NewCampaignInput = {
        territory_id: territoryId,
        venue_ids: cart.map((v) => v.id),
        exclusive_venue_ids: [...exclSet],
        category_id: categoryId,
        title,
        qr_target_url: qrTarget,
        qr_x: qrX,
        qr_y: qrY,
        qr_size: qrSize,
        creative_type,
        creative_url,
        creative_help_brief: mode === 'help' ? brief : null,
        base_path: base,
      }

      const res = await submitCampaign(input)
      if (res.error) {
        setStatusMsg(null)
        toast.error(res.error)
        return
      }
      try {
        sessionStorage.removeItem(CART_KEY)
        sessionStorage.removeItem(EXCL_KEY)
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
        subtitle="A 15-second spot. Images look best at 16:9 — 1920 × 1080."
      />

      <div className="space-y-1.5">
        <Label>Ad title</Label>
        <Input className="h-11" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>

      {categoryName && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Category (locked)</span>
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
            <label
              onDragOver={(e) => {
                e.preventDefault()
                setDragActive(true)
              }}
              onDragEnter={(e) => {
                e.preventDefault()
                setDragActive(true)
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                setDragActive(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setDragActive(false)
                pickFile(e.dataTransfer.files?.[0] ?? null)
              }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center transition ${
                dragActive ? 'border-primary bg-primary/10' : 'border-border bg-muted/30 hover:border-primary/50'
              }`}
            >
              <Upload className="size-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {file
                  ? file.name
                  : dragActive
                    ? 'Drop to upload'
                    : 'Tap to upload, or drag an image or video here'}
              </span>
              {file && (
                <span className="text-xs text-muted-foreground">
                  {(file.size / 1_000_000).toFixed(1)} MB · tap to replace
                </span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={CREATIVE_ACCEPT}
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <CreativeFitNotice file={file} />

            {file && fileUrl && (
              <div className="space-y-3 pt-1">
                <p className="text-xs text-muted-foreground">
                  Preview — this is how your ad shows on screen. Drag the code anywhere
                  {!isVideo ? '; pinch or scroll to zoom and drag to reposition the photo' : ''}.
                </p>
                <div
                  ref={frameRef}
                  className="relative aspect-video w-full overflow-hidden rounded-lg bg-black select-none"
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
                    <Cropper
                      image={fileUrl}
                      crop={crop}
                      zoom={zoom}
                      rotation={rotation}
                      minZoom={1}
                      maxZoom={3}
                      aspect={16 / 9}
                      objectFit="cover"
                      showGrid={false}
                      onCropChange={setCrop}
                      onZoomChange={setZoom}
                      onRotationChange={setRotation}
                      onCropComplete={(_area, px) => setCroppedAreaPixels(px)}
                      style={{ mediaStyle: { filter: filterStr }, cropAreaStyle: { border: 0 } }}
                    />
                  )}
                  {qrTarget && (
                    <div
                      ref={qrChipRef}
                      onPointerDown={onQrDown}
                      onPointerMove={onQrMove}
                      onPointerUp={onQrUp}
                      onPointerCancel={onQrUp}
                      className="absolute z-10 cursor-grab touch-none rounded-md bg-white p-1 ring-2 ring-[#d4af37] active:cursor-grabbing"
                      style={{
                        left: `${qrX * 100}%`,
                        top: `${qrY * 100}%`,
                        width: `${qrSize * 100}%`,
                        transform: 'translate(-50%, -50%)',
                      }}
                    >
                      {qrPreview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={qrPreview}
                          alt="QR preview"
                          draggable={false}
                          className="block w-full rounded-sm"
                        />
                      ) : (
                        <div className="aspect-square w-full rounded-sm bg-muted" />
                      )}
                    </div>
                  )}
                </div>

                {qrTarget && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label>QR code size</Label>
                      <span className="text-xs text-muted-foreground">
                        {Math.round(qrSize * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={QR_SIZE_MIN}
                      max={QR_SIZE_MAX}
                      step={0.005}
                      value={qrSize}
                      onChange={(e) => setQrSize(Number(e.target.value))}
                      className="h-2 w-full cursor-pointer accent-primary"
                    />
                    <p className="text-xs text-muted-foreground">
                      Drag the code to move it; use the slider to size it. This is exactly how it
                      shows on screen.
                    </p>
                  </div>
                )}

                {!isVideo && (
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => setShowAdjust((s) => !s)}
                      className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm font-medium transition hover:border-primary/40"
                    >
                      <span className="flex items-center gap-2">
                        <SlidersHorizontal className="size-4 text-muted-foreground" /> Adjust photo
                      </span>
                      <ChevronDown
                        className={`size-4 text-muted-foreground transition-transform ${showAdjust ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {showAdjust && (
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
                        onChange={(e) => setZoom(Number(e.target.value))}
                        className="h-2 w-full cursor-pointer accent-primary"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label>Rotation</Label>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{Math.round(rotation)}°</span>
                          <button
                            type="button"
                            onClick={rotate90}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium transition hover:border-primary/40"
                          >
                            <RotateCw className="size-3.5" /> 90°
                          </button>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        value={rotation}
                        onChange={(e) => setRotation(Number(e.target.value))}
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
        label={pending ? statusMsg ?? 'Working…' : 'Continue to payment'}
        disabled={pending}
        onClick={onSubmit}
        priceTop="Total"
        priceMain={`${formatCents(totalWithCreative)}/mo`}
      />
    </div>
  )
}

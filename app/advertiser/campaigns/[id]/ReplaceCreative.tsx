'use client'

import { useEffect, useRef, useState, useTransition, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, Upload, X, SlidersHorizontal, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { CreativeFitNotice } from '@/components/app/CreativeFitNotice'
import { AD_CHANGE_NOTICE_DAYS } from '@/lib/fees'
import { useBasePath } from '@/lib/useBasePath'
import {
  EXPORT_W,
  EXPORT_H,
  QR_DEFAULT,
  FILTER_PRESETS,
  clampPan,
  buildFilter,
  computeDraw,
  exportImageBlob,
  type FilterPreset,
} from '@/lib/adCreative'
import { replaceCreative } from './actions'

// Swap the creative on an existing campaign — now with the SAME editor as the
// new-campaign flow (crop / zoom / pan / filter + a WYSIWYG frame), so a swap
// looks like what will actually air instead of a bare file input. The QR keeps
// its existing on-ad position (shown here read-only) since the swap only changes
// the artwork; members change free, everyone else pays the $10 fee at Checkout.
export function ReplaceCreative({
  campaignId,
  userId,
  qrTargetUrl,
  qrX,
  qrY,
}: {
  campaignId: string
  userId: string
  qrTargetUrl?: string | null
  qrX?: number | null
  qrY?: number | null
}) {
  const router = useRouter()
  const base = useBasePath()
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [qrPreview, setQrPreview] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  // Photo editor (images only) — mirrors CreativeStep.
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  const [preset, setPreset] = useState<FilterPreset>('none')
  const [showAdjust, setShowAdjust] = useState(false)

  const frameRef = useRef<HTMLDivElement>(null)
  const panDragRef = useRef<{ px: number; py: number; panX: number; panY: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isVideo = !!file && file.type.startsWith('video')
  const filterStr = buildFilter(preset, brightness, contrast)
  const qcx = qrX ?? QR_DEFAULT.x
  const qcy = qrY ?? QR_DEFAULT.y

  // Object URL for the chosen file; resets the editor whenever the file changes.
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setBrightness(100)
    setContrast(100)
    setPreset('none')
    setShowAdjust(false)
    setNat(null)
    if (!file) {
      setFileUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setFileUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Render the ad's existing scan-link QR so the preview matches the TV exactly.
  useEffect(() => {
    const url = (qrTargetUrl ?? '').trim()
    if (!url) {
      setQrPreview(null)
      return
    }
    let alive = true
    import('qrcode')
      .then(({ default: QR }) =>
        QR.toDataURL(url, { margin: 1, width: 240, color: { dark: '#000000', light: '#ffffff' } })
      )
      .then((data) => alive && setQrPreview(data))
      .catch(() => alive && setQrPreview(null))
    return () => {
      alive = false
    }
  }, [qrTargetUrl])

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

  function submit() {
    if (!file) return toast.error('Choose an image or video first.')
    start(async () => {
      setStatusMsg('Uploading your ad…')
      const supabase = createClient()
      // Images are composited (crop + zoom + pan + filter) to a PNG; videos upload
      // raw. Same convention as the first upload in the new-campaign wizard.
      let blob: Blob = file
      let ext = file.name.split('.').pop() ?? 'bin'
      let contentType = file.type
      if (!isVideo && fileUrl) {
        try {
          blob = await exportImageBlob(fileUrl, { zoom, pan, filterStr })
        } catch (e) {
          setStatusMsg(null)
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
        setStatusMsg(null)
        toast.error(`Upload failed: ${upErr.message}`)
        return
      }
      const url = supabase.storage.from('creatives').getPublicUrl(path).data.publicUrl
      const type: 'image' | 'video' = isVideo ? 'video' : 'image'
      setStatusMsg('Submitting…')
      const res = await replaceCreative(campaignId, url, type, base)
      if (res.error) {
        setStatusMsg(null)
        toast.error(res.error)
        return
      }
      if (res.checkoutUrl) {
        window.location.assign(res.checkoutUrl)
        return
      }
      toast.success('New creative submitted for review.')
      setFile(null)
      setOpen(false)
      setStatusMsg(null)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <RefreshCw className="size-4" /> Replace creative
      </Button>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Upload a new creative</p>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            setOpen(false)
            setFile(null)
          }}
        >
          <X className="size-4" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Images look best at 16:9 — 1920 × 1080. Your new spot goes to review, then replaces the
        current one on your screens. Placements and billing stay as they are. We ask for{' '}
        {AD_CHANGE_NOTICE_DAYS} days notice on changes.
      </p>

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
            Preview — this is how your ad will show on screen
            {!isVideo ? '. Drag the photo to reposition it' : ''}.
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
                  setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                }
                onPointerDown={onPanDown}
                onPointerMove={onPanMove}
                onPointerUp={onPanUp}
                onPointerCancel={onPanUp}
                className="cursor-grab touch-none select-none active:cursor-grabbing"
                style={imgStyle}
              />
            )}
            {qrPreview && (
              <div
                className="absolute rounded-md bg-white p-1 ring-2 ring-[#d4af37]"
                style={{ left: `${qcx * 100}%`, top: `${qcy * 100}%`, transform: 'translate(-50%, -50%)' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrPreview} alt="QR preview" draggable={false} className="size-12 rounded-sm" />
              </div>
            )}
          </div>

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
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending || !file} onClick={submit}>
          <Upload className="size-4" /> {pending ? statusMsg ?? 'Working…' : 'Submit for review'}
        </Button>
      </div>
    </div>
  )
}

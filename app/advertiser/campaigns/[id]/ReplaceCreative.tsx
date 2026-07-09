'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Cropper, { type Area, type Point } from 'react-easy-crop'
import { RefreshCw, Upload, X, SlidersHorizontal, ChevronDown, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { CreativeFitNotice } from '@/components/app/CreativeFitNotice'
import { AD_CHANGE_NOTICE_DAYS } from '@/lib/fees'
import { useBasePath } from '@/lib/useBasePath'
import {
  QR_DEFAULT,
  FILTER_PRESETS,
  buildFilter,
  getCroppedImg,
  validateCreativeFile,
  CREATIVE_ACCEPT,
  type FilterPreset,
} from '@/lib/adCreative'
import { replaceCreative } from './actions'

// Swap the creative on an existing campaign — now with the SAME editor as the
// new-campaign flow (crop / zoom / rotation / filter + a WYSIWYG frame), so a swap
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

  // Photo editor (images only) — mirrors CreativeStep (react-easy-crop).
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  const [preset, setPreset] = useState<FilterPreset>('none')
  const [showAdjust, setShowAdjust] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const isVideo = !!file && file.type.startsWith('video')
  const filterStr = buildFilter(preset, brightness, contrast)
  const qcx = qrX ?? QR_DEFAULT.x
  const qcy = qrY ?? QR_DEFAULT.y

  // Validate a chosen creative before accepting it (web-safe video, size cap) so a
  // file that would silently fail on the TV is rejected here with a clear reason.
  function pickFile(f: File | null) {
    if (!f) return setFile(null)
    const err = validateCreativeFile(f)
    if (err) return toast.error(err)
    setFile(f)
  }

  // Object URL for the chosen file; resets the editor whenever the file changes.
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

  // Quarter-turn for phone photos that come in sideways (stays within the slider's range).
  function rotate90() {
    setRotation((r) => {
      const n = r + 90
      return n > 180 ? n - 360 : n
    })
  }

  function submit() {
    if (!file) return toast.error('Choose an image or video first.')
    start(async () => {
      setStatusMsg('Uploading your ad…')
      const supabase = createClient()
      // Images are composited (crop + zoom + rotation + filter) to a PNG; videos upload
      // raw. Same convention as the first upload in the new-campaign wizard.
      let blob: Blob = file
      let ext = file.name.split('.').pop() ?? 'bin'
      let contentType = file.type
      if (!isVideo && fileUrl) {
        if (!croppedAreaPixels) {
          setStatusMsg(null)
          toast.error('Give the image a moment to finish loading, then try again.')
          return
        }
        try {
          blob = await getCroppedImg(fileUrl, croppedAreaPixels, rotation, filterStr)
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
        current one on your screens. Placements and billing stay as they are. Your first change each
        week is free. We ask for {AD_CHANGE_NOTICE_DAYS} days notice on changes.
      </p>

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
          {file ? file.name : dragActive ? 'Drop to upload' : 'Tap to upload, or drag an image or video here'}
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
            Preview — this is how your ad will show on screen
            {!isVideo ? '. Pinch or scroll to zoom and drag to reposition the photo' : ''}.
          </p>
          <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black select-none">
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
            {qrPreview && (
              <div
                className="pointer-events-none absolute z-10 rounded-md bg-white p-1 ring-2 ring-[#d4af37]"
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

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending || !file} onClick={submit}>
          <Upload className="size-4" /> {pending ? statusMsg ?? 'Working…' : 'Submit for review'}
        </Button>
      </div>
    </div>
  )
}

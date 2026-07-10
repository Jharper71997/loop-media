'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { type Area, type Point } from 'react-easy-crop'
// react-easy-crop only mounts once the user opens the image editor, so load it
// on demand (client-only) to keep it out of this route's initial JS bundle.
// Cast back to react-easy-crop's own class type so JSX keeps honoring its
// defaultProps — CropperProps marks defaulted props (cropShape, zoomSpeed, …)
// as required, which dynamic() would otherwise force onto every call site.
const Cropper = dynamic(() => import('react-easy-crop'), {
  ssr: false,
}) as unknown as (typeof import('react-easy-crop'))['default']
import { Upload, X, Trash2, RotateCw, ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { LOGO_ACCEPT, validateLogoFile, getCroppedLogoImg } from '@/lib/adCreative'
import { setVenueLogo } from '../actions'

// Host uploads / changes their venue's business logo. Square round crop
// (react-easy-crop, aspect 1) so it reads cleanly as the round map pin and the
// popup avatar. Uploads to the public venue-logos bucket under the host's own uid
// folder (required by the storage RLS), then persists the URL via setVenueLogo.
export function LogoUploader({
  venueId,
  userId,
  initialLogoUrl,
}: {
  venueId: string
  userId: string
  initialLogoUrl: string | null
}) {
  const router = useRouter()
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl)
  const [file, setFile] = useState<File | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [pending, start] = useTransition()
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function pickFile(f: File | null) {
    if (!f) return setFile(null)
    const err = validateLogoFile(f)
    if (err) return toast.error(err)
    setFile(f)
  }

  // Object URL for the chosen file; reset the editor whenever the file changes.
  useEffect(() => {
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setRotation(0)
    setCroppedAreaPixels(null)
    if (!file) {
      setFileUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setFileUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function rotate90() {
    setRotation((r) => {
      const n = r + 90
      return n > 180 ? n - 360 : n
    })
  }

  function save() {
    if (!file || !fileUrl) return
    if (!croppedAreaPixels) {
      return toast.error('Give the image a moment to finish loading, then try again.')
    }
    start(async () => {
      setStatusMsg('Uploading…')
      try {
        const blob = await getCroppedLogoImg(fileUrl, croppedAreaPixels, rotation)
        const supabase = createClient()
        const path = `${userId}/${crypto.randomUUID()}.png`
        const { error: upErr } = await supabase.storage
          .from('venue-logos')
          .upload(path, blob, { contentType: 'image/png' })
        if (upErr) {
          setStatusMsg(null)
          toast.error(`Upload failed: ${upErr.message}`)
          return
        }
        const url = supabase.storage.from('venue-logos').getPublicUrl(path).data.publicUrl
        const res = await setVenueLogo(venueId, url)
        if (res.error) {
          setStatusMsg(null)
          toast.error(res.error)
          return
        }
        setLogoUrl(url)
        setFile(null)
        setStatusMsg(null)
        toast.success('Logo saved.')
        router.refresh()
      } catch (e) {
        setStatusMsg(null)
        toast.error(e instanceof Error ? e.message : 'Could not process image.')
      }
    })
  }

  function remove() {
    start(async () => {
      const res = await setVenueLogo(venueId, null)
      if (res.error) {
        toast.error(res.error)
        return
      }
      setLogoUrl(null)
      setFile(null)
      toast.success('Logo removed.')
      router.refresh()
    })
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div>
        <Label className="text-sm font-medium">Business logo</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Shows on the advertiser map so your venue reads as a real business. Square works best.
        </p>
      </div>

      {/* Current logo + actions (hidden while actively cropping a new one) */}
      {!file && (
        <div className="flex items-center gap-4">
          <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-muted/40">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Venue logo" className="size-full object-cover" />
            ) : (
              <ImageIcon className="size-7 text-muted-foreground" />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="size-4" /> {logoUrl ? 'Change logo' : 'Upload logo'}
            </Button>
            {logoUrl && (
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={remove}>
                <Trash2 className="size-4" /> Remove
              </Button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={LOGO_ACCEPT}
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
        </div>
      )}

      {/* Cropper */}
      {file && fileUrl && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Drag to reposition · pinch or scroll to zoom</p>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setFile(null)}
              aria-label="Cancel"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="relative mx-auto aspect-square w-full max-w-64 overflow-hidden rounded-lg bg-black select-none">
            <Cropper
              image={fileUrl}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              minZoom={0.5}
              maxZoom={3}
              aspect={1}
              cropShape="round"
              objectFit="contain"
              showGrid={true}
              restrictPosition={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onRotationChange={setRotation}
              onCropComplete={(_area, px) => setCroppedAreaPixels(px)}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Zoom</Label>
              <button
                type="button"
                onClick={rotate90}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium transition hover:border-primary/40"
              >
                <RotateCw className="size-3.5" /> 90°
              </button>
            </div>
            <input
              type="range"
              min={0.5}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="h-2 w-full cursor-pointer accent-primary"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={save}>
              <Upload className="size-4" /> {pending ? statusMsg ?? 'Working…' : 'Save logo'}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setFile(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Megaphone, Trash2, Tv } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import {
  QR_DEFAULT,
  QR_SIZE_DEFAULT,
  exportImageBlob,
  validateCreativeFile,
  CREATIVE_ACCEPT,
} from '@/lib/adCreative'
import { CreativeImageEditor, type CreativeImageEditorHandle } from '@/components/app/CreativeImageEditor'
import { QrChip } from '@/components/app/QrChip'
import { CreativeVideo } from '@/components/app/CreativeVideo'
import { ConfirmButton } from '@/components/app/ConfirmButton'
import { submitOwnScreenPromo, deleteOwnScreenPromo } from './actions'

export interface PromoVenue {
  id: string
  name: string
}

export interface ExistingPromo {
  campaignId: string
  title: string
  venueName: string
}

// A host puts their OWN promo on their OWN screen — free, no checkout, plays within
// ~30s. One promo per screen at a time; remove it to swap.
export function OwnPromoForm({
  userId,
  venues,
  existing,
}: {
  userId: string
  // Venues that are live, have a screen, and don't already have an own-screen promo.
  venues: PromoVenue[]
  existing: ExistingPromo[]
}) {
  const router = useRouter()
  const [venueId, setVenueId] = useState(venues[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [qrUrl, setQrUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [qrPreview, setQrPreview] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<CreativeImageEditorHandle>(null)

  const isVideo = !!file && file.type.startsWith('video')

  function pickFile(f: File | null) {
    if (!f) return setFile(null)
    const err = validateCreativeFile(f)
    if (err) return toast.error(err)
    setFile(f)
  }

  // Local preview URL for the chosen file (revoked on change). The preview is
  // guarded on `file &&`, so we don't need to null it out when the file clears.
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setFileUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const qrTarget = useMemo(() => qrUrl.trim(), [qrUrl])

  // Render the scan QR client-side so the preview matches the TV exactly.
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
      .then((d) => alive && setQrPreview(d))
      .catch(() => alive && setQrPreview(null))
    return () => {
      alive = false
    }
  }, [qrTarget])

  function onSubmit() {
    if (!venueId) return toast.error('Pick which screen this runs on.')
    if (!title.trim()) return toast.error('Give your promo a title.')
    if (!qrTarget) return toast.error('Add the link people go to when they scan it.')
    if (!file) return toast.error('Upload an image or video.')

    start(async () => {
      setStatusMsg('Uploading…')
      const supabase = createClient()

      // Images are normalized to a 16:9 PNG (matches the advertiser flow); videos
      // upload raw. The QR is a render-time overlay on the TV, not baked in.
      let blob: Blob = file
      let ext = file.name.split('.').pop() ?? 'bin'
      let contentType = file.type
      if (!isVideo && fileUrl) {
        const params = editorRef.current?.getExportParams()
        if (!params) {
          setStatusMsg(null)
          toast.error('Give the image a moment to finish loading, then try again.')
          return
        }
        try {
          blob = await exportImageBlob(fileUrl, params)
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
      const creative_url = supabase.storage.from('creatives').getPublicUrl(path).data.publicUrl

      setStatusMsg('Putting it on your screen…')
      const res = await submitOwnScreenPromo({
        venue_id: venueId,
        title,
        qr_target_url: qrTarget,
        creative_type: isVideo ? 'video' : 'image',
        creative_url,
        qr_x: QR_DEFAULT.x,
        qr_y: QR_DEFAULT.y,
        qr_size: QR_SIZE_DEFAULT,
      })
      setStatusMsg(null)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Your promo is live on your screen.')
      setTitle('')
      setQrUrl('')
      setFile(null)
      router.refresh()
    })
  }

  // Returns the { error } shape so ConfirmButton toasts/keeps-open on failure and
  // toasts success + closes on the happy path; refresh the list once it's gone.
  async function onRemove(campaignId: string): Promise<{ error: string | null }> {
    const res = await deleteOwnScreenPromo(campaignId)
    if (!res.error) router.refresh()
    return { error: res.error ?? null }
  }

  return (
    <div className="space-y-6">
      {/* What's currently on your own screens */}
      {existing.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">On your screen now</h2>
          <Card>
            <CardContent className="p-2">
              <ul className="divide-y divide-border">
                {existing.map((p) => (
                  <li
                    key={p.campaignId}
                    className="flex items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      <Megaphone className="size-4 shrink-0 text-primary" />
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{p.title}</span>
                        <span className="text-muted-foreground"> · {p.venueName}</span>
                      </span>
                    </span>
                    <ConfirmButton
                      variant="outline"
                      size="sm"
                      title="Remove this promo?"
                      description="It comes off your screen right away. You can add a new one after."
                      confirmText="Remove"
                      successToast="Promo removed."
                      onConfirm={() => onRemove(p.campaignId)}
                    >
                      <Trash2 className="size-4" /> Remove
                    </ConfirmButton>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}

      {venues.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <Tv className="size-6 text-muted-foreground" />
            {existing.length > 0
              ? 'Each of your screens already has a promo. Remove one above to add a different one.'
              : 'No live screen yet. Once your venue is approved and your screen is set up, you can put a promo on it here.'}
          </CardContent>
        </Card>
      ) : (
        <section className="space-y-4">
          <h2 className="text-sm font-medium">Add a promo to your screen</h2>

          {venues.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="promo-venue">Which screen</Label>
              <select
                id="promo-venue"
                value={venueId}
                onChange={(e) => setVenueId(e.target.value)}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="promo-title">Promo title</Label>
            <Input
              id="promo-title"
              className="h-11"
              placeholder="Happy hour 4–6pm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="promo-link">Link when scanned</Label>
            <Input
              id="promo-link"
              type="url"
              className="h-11"
              placeholder="https://your-site.com/offer"
              value={qrUrl}
              onChange={(e) => setQrUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              A QR code in the corner sends people here — this is how you track scans.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="promo-file">Your image or video</Label>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center transition hover:border-primary/50">
              <Upload className="size-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {file ? file.name : 'Tap to upload an image or video'}
              </span>
              <span className="text-xs text-muted-foreground">
                {file
                  ? `${(file.size / 1_000_000).toFixed(1)} MB · tap to replace`
                  : 'Looks best at 16:9 — 1920 × 1080'}
              </span>
              <input
                ref={fileInputRef}
                id="promo-file"
                type="file"
                accept={CREATIVE_ACCEPT}
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
            </label>

            {file &&
              fileUrl &&
              (isVideo ? (
                <div className="relative aspect-video w-full select-none overflow-hidden rounded-lg">
                  <CreativeVideo src={fileUrl} muted autoPlay loop playsInline />
                  <QrChip src={qrPreview} x={QR_DEFAULT.x} y={QR_DEFAULT.y} size={QR_SIZE_DEFAULT} />
                </div>
              ) : (
                <CreativeImageEditor
                  ref={editorRef}
                  src={fileUrl}
                  qr={{ src: qrPreview, x: QR_DEFAULT.x, y: QR_DEFAULT.y, size: QR_SIZE_DEFAULT }}
                />
              ))}
          </div>

          <Button className="h-11 w-full" disabled={pending} onClick={onSubmit}>
            {pending ? statusMsg ?? 'Working…' : 'Put it on my screen — free'}
          </Button>
        </section>
      )}
    </div>
  )
}

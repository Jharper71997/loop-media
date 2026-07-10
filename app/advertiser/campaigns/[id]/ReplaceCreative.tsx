'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { CreativeFitNotice } from '@/components/app/CreativeFitNotice'
import { AD_CHANGE_NOTICE_DAYS } from '@/lib/fees'
import { useBasePath } from '@/lib/useBasePath'
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
import { replaceCreative } from './actions'

// Swap the creative on an existing campaign — same free-transform editor as the
// new-campaign flow (zoom out / drag / corner-resize / rotate / filter on a 16:9
// stage), so a swap looks exactly like what will air. The QR keeps its existing
// on-ad position + size (shown here read-only) since the swap only changes the
// artwork; members change free, everyone else pays the $10 fee at Checkout.
export function ReplaceCreative({
  campaignId,
  userId,
  qrTargetUrl,
  qrX,
  qrY,
  qrSize,
}: {
  campaignId: string
  userId: string
  qrTargetUrl?: string | null
  qrX?: number | null
  qrY?: number | null
  qrSize?: number | null
}) {
  const router = useRouter()
  const base = useBasePath()
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [qrPreview, setQrPreview] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)

  const editorRef = useRef<CreativeImageEditorHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isVideo = !!file && file.type.startsWith('video')
  const qcx = qrX ?? QR_DEFAULT.x
  const qcy = qrY ?? QR_DEFAULT.y
  const qsize = qrSize ?? QR_SIZE_DEFAULT

  // Validate a chosen creative before accepting it (web-safe video, size cap) so a
  // file that would silently fail on the TV is rejected here with a clear reason.
  function pickFile(f: File | null) {
    if (!f) return setFile(null)
    const err = validateCreativeFile(f)
    if (err) return toast.error(err)
    setFile(f)
  }

  // Object URL for the chosen file. The image editor resets its own transform.
  useEffect(() => {
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

  function submit() {
    if (!file) return toast.error('Choose an image or video first.')
    start(async () => {
      setStatusMsg('Uploading your ad…')
      const supabase = createClient()
      // Images bake to a 16:9 PNG via the editor's transform; videos upload raw.
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
            Preview — this is exactly how your ad will show on screen
            {!isVideo ? '. Drag a corner to resize, or zoom out to fit the whole photo' : ''}.
          </p>
          {isVideo ? (
            <div className="relative aspect-video w-full select-none overflow-hidden rounded-lg">
              <CreativeVideo src={fileUrl} muted autoPlay loop playsInline />
              {qrPreview && <QrChip src={qrPreview} x={qcx} y={qcy} size={qsize} />}
            </div>
          ) : (
            <CreativeImageEditor
              ref={editorRef}
              src={fileUrl}
              qr={qrPreview ? { src: qrPreview, x: qcx, y: qcy, size: qsize } : undefined}
            />
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

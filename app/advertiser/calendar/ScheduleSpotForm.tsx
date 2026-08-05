'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarPlus, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CreativeFitNotice } from '@/components/app/CreativeFitNotice'
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
import { formatDay } from '@/lib/calendar'
import { scheduleCreative } from './actions'
import type { CalendarCampaign } from './CalendarClient'

// Book one spot onto a date. Same upload + 16:9 editor + QR preview as the
// campaign page's "Replace creative", so what an advertiser stages here looks
// exactly like what will air — the only difference is that it lands on a date
// instead of tonight.
export function ScheduleSpotForm({
  campaigns,
  runOn,
  showYear,
  onDone,
  onCancel,
  userId,
}: {
  campaigns: CalendarCampaign[]
  runOn: string
  showYear: boolean
  onDone: () => void
  onCancel: () => void
  userId: string
}) {
  const router = useRouter()
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? '')
  const [label, setLabel] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [qrPreview, setQrPreview] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const editorRef = useRef<CreativeImageEditorHandle>(null)
  const campaign = campaigns.find((c) => c.id === campaignId) ?? campaigns[0]
  const isVideo = !!file && file.type.startsWith('video')
  const qcx = campaign?.qrX ?? QR_DEFAULT.x
  const qcy = campaign?.qrY ?? QR_DEFAULT.y
  const qsize = campaign?.qrSize ?? QR_SIZE_DEFAULT

  function pickFile(f: File | null) {
    if (!f) return setFile(null)
    const err = validateCreativeFile(f)
    if (err) return toast.error(err)
    setFile(f)
  }

  useEffect(() => {
    if (!file) {
      setFileUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setFileUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // The QR belongs to the chosen campaign's ad, so it re-renders when the
  // advertiser switches campaigns mid-form.
  useEffect(() => {
    const url = (campaign?.qrTargetUrl ?? '').trim()
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
  }, [campaign?.qrTargetUrl])

  function submit() {
    if (!campaignId) return toast.error('Pick a campaign.')
    if (!file) return toast.error('Choose an image or video first.')
    start(async () => {
      setStatusMsg('Uploading…')
      const supabase = createClient()
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

      setStatusMsg('Saving to your calendar…')
      const res = await scheduleCreative({
        campaignId,
        creativeUrl: url,
        creativeType: isVideo ? 'video' : 'image',
        runOn,
        label,
      })
      setStatusMsg(null)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(`Scheduled for ${formatDay(runOn, showYear)}.`)
      setFile(null)
      setLabel('')
      onDone()
      router.refresh()
    })
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Schedule a spot for {formatDay(runOn, showYear)}</p>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={onCancel}
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>

      {campaigns.length > 1 && (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Campaign</span>
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">
          What is this spot? (just for your calendar)
        </span>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={80}
          placeholder="Nickel Night, fall menu, Labor Day hours…"
        />
      </label>

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
          dragActive
            ? 'border-primary bg-primary/10'
            : 'border-border bg-muted/30 hover:border-primary/50'
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
          type="file"
          accept={CREATIVE_ACCEPT}
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <CreativeFitNotice file={file} />

      {file && fileUrl && (
        <div className="space-y-2 pt-1">
          <p className="text-xs text-muted-foreground">
            Preview — this is exactly how it will show on screen
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

      <Button size="sm" disabled={pending || !file} onClick={submit}>
        <CalendarPlus className="size-4" />
        {pending ? (statusMsg ?? 'Working…') : 'Add to calendar'}
      </Button>
    </div>
  )
}

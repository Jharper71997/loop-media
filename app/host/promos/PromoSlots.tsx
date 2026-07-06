'use client'

import { useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { Upload, Trash2, Plus, ImageOff } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { ConfirmButton } from '@/components/app/ConfirmButton'
import { CreativeFitNotice } from '@/components/app/CreativeFitNotice'
import { submitHostPromo, deleteHostPromo } from './actions'
import type { PromoVenue } from './PromoMapPicker'

// Leaflet touches `window`, so the map only renders client-side.
const PromoMapPicker = dynamic(() => import('./PromoMapPicker'), {
  ssr: false,
  loading: () => (
    <div className="grid h-[40vh] min-h-64 place-items-center rounded-xl border border-border text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
})

type Venue = PromoVenue
type Promo = {
  id: string
  title: string
  status: string
  creative_type: string
  creative_url: string | null
  target_venue_name: string | null
}

function statusBadge(status: string) {
  switch (status) {
    case 'approved':
    case 'active':
      return { label: 'Live', cls: 'bg-emerald-600' }
    case 'paused':
      return { label: 'Paused', cls: 'bg-zinc-600' }
    default:
      return { label: 'In review', cls: 'bg-amber-600' }
  }
}

export function PromoSlots({
  userId,
  venues,
  promos,
  maxSlots,
  homeLoc,
}: {
  userId: string
  venues: Venue[]
  promos: Promo[]
  maxSlots: number
  homeLoc?: [number, number] | null
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const remaining = maxSlots - promos.length

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {promos.map((p) => {
        const b = statusBadge(p.status)
        return (
          <Card key={p.id} className="overflow-hidden">
            <div className="flex aspect-video items-center justify-center bg-black">
              {p.creative_url ? (
                p.creative_type === 'video' ? (
                  <video src={p.creative_url} className="h-full w-full object-contain" muted />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.creative_url} alt={p.title} className="h-full w-full object-contain" />
                )
              ) : (
                <ImageOff className="size-6 text-muted-foreground" />
              )}
            </div>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{p.title}</p>
                <Badge className={b.cls}>{b.label}</Badge>
              </div>
              {p.target_venue_name && (
                <p className="text-xs text-muted-foreground">Running on {p.target_venue_name}</p>
              )}
              <ConfirmButton
                onConfirm={async () => {
                  const res = await deleteHostPromo(p.id)
                  if (!res.error) router.refresh()
                  return res
                }}
                title="Remove this promo?"
                description="It stops running on your screens. This can’t be undone."
                confirmText="Remove"
                successToast="Promo removed"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="size-4" /> Remove
              </ConfirmButton>
            </CardContent>
          </Card>
        )
      })}

      {remaining > 0 &&
        venues.length === 0 &&
        promos.length === 0 && (
          <Card className="sm:col-span-2">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              There aren&apos;t any other Loop Network screens to run on yet. Check back as the
              network grows.
            </CardContent>
          </Card>
        )}

      {remaining > 0 &&
        venues.length > 0 &&
        (adding ? (
          <AddPromoCard
            userId={userId}
            venues={venues}
            homeLoc={homeLoc}
            onCancel={() => setAdding(false)}
            onDone={() => {
              setAdding(false)
              router.refresh()
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={cn(
              'flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground transition hover:border-primary/50 hover:text-foreground'
            )}
          >
            <Plus className="size-5" />
            Add a promo
            <span className="text-xs">
              {remaining} of {maxSlots} slot{remaining === 1 ? '' : 's'} free
            </span>
          </button>
        ))}
    </div>
  )
}

function AddPromoCard({
  userId,
  venues,
  homeLoc,
  onCancel,
  onDone,
}: {
  userId: string
  venues: Venue[]
  homeLoc?: [number, number] | null
  onCancel: () => void
  onDone: () => void
}) {
  // No default pick — the host taps a screen on the map to choose where it runs.
  const [venueId, setVenueId] = useState('')
  const [title, setTitle] = useState('')
  const [qrUrl, setQrUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [pending, start] = useTransition()
  const selectedVenue = venues.find((v) => v.id === venueId)

  function save() {
    if (!venueId) {
      toast.error('Pick a screen to run your promo on.')
      return
    }
    if (!title.trim()) {
      toast.error('Give your promo a title.')
      return
    }
    if (!file) {
      toast.error('Upload a promo image or video.')
      return
    }
    if (!qrUrl.trim()) {
      toast.error('Add the link people go to when they scan your promo.')
      return
    }
    start(async () => {
      const supabase = createClient()
      const ext = file.name.split('.').pop() ?? 'bin'
      const path = `${userId}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage.from('host-promos').upload(path, file)
      if (upErr) {
        toast.error(`Upload failed: ${upErr.message}`)
        return
      }
      const creative_url = supabase.storage.from('host-promos').getPublicUrl(path).data.publicUrl
      const res = await submitHostPromo({
        target_venue_id: venueId,
        title,
        creative_type: file.type.startsWith('video') ? 'video' : 'image',
        creative_url,
        qr_target_url: qrUrl.trim(),
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Promo submitted for review')
      onDone()
    })
  }

  return (
    <Card className="sm:col-span-2">
      <CardContent className="space-y-3 p-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Where should this run?</Label>
          <PromoMapPicker venues={venues} value={venueId} onSelect={setVenueId} homeLoc={homeLoc} />
          <p className="text-xs text-muted-foreground">
            {selectedVenue
              ? `Running on ${selectedVenue.name}`
              : 'Tap an open screen on the map to pick where your promo runs.'}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Promo title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Happy Hour 4–6pm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">15-second image or video</Label>
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
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <CreativeFitNotice file={file} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">QR scan link</Label>
          <Input
            type="url"
            value={qrUrl}
            onChange={(e) => setQrUrl(e.target.value)}
            placeholder="https://your-site.com/menu"
            required
          />
          <p className="text-xs text-muted-foreground">
            A QR code on your promo sends scanners here, so you can track results.
          </p>
        </div>
        <div className="flex gap-2 pt-1">
          <Button size="sm" disabled={pending} onClick={save}>
            <Upload className="size-4" /> {pending ? 'Submitting…' : 'Submit'}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Trash2, Plus, ImageOff } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { submitHostPromo, deleteHostPromo } from './actions'

type Venue = { id: string; name: string }
type Promo = {
  id: string
  title: string
  status: string
  creative_type: string
  creative_url: string | null
  host_venue_id: string | null
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
}: {
  userId: string
  venues: Venue[]
  promos: Promo[]
  maxSlots: number
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const remaining = maxSlots - promos.length
  const venueName = (id: string | null) => venues.find((v) => v.id === id)?.name ?? ''

  if (venues.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          No venue is linked to your account yet, so there&apos;s nowhere to run a promo.
          Reach out to your Loop Network contact to get your screen set up.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              {venues.length > 1 && (
                <p className="text-xs text-muted-foreground">{venueName(p.host_venue_id)}</p>
              )}
              <DeleteButton id={p.id} onDone={() => router.refresh()} />
            </CardContent>
          </Card>
        )
      })}

      {remaining > 0 &&
        (adding ? (
          <AddPromoCard
            userId={userId}
            venues={venues}
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

function DeleteButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [pending, start] = useTransition()
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-destructive hover:text-destructive"
      disabled={pending}
      onClick={() => {
        if (!window.confirm('Remove this promo? It will stop running on your screens.')) return
        start(async () => {
          const res = await deleteHostPromo(id)
          if (res.error) toast.error(res.error)
          else {
            toast.success('Promo removed')
            onDone()
          }
        })
      }}
    >
      <Trash2 className="size-4" /> Remove
    </Button>
  )
}

function AddPromoCard({
  userId,
  venues,
  onCancel,
  onDone,
}: {
  userId: string
  venues: Venue[]
  onCancel: () => void
  onDone: () => void
}) {
  const [venueId, setVenueId] = useState(venues[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [qrUrl, setQrUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [pending, start] = useTransition()

  function save() {
    if (!title.trim()) {
      toast.error('Give your promo a title.')
      return
    }
    if (!file) {
      toast.error('Upload a promo image or video.')
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
        venue_id: venueId,
        title,
        creative_type: file.type.startsWith('video') ? 'video' : 'image',
        creative_url,
        qr_target_url: qrUrl.trim() || null,
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
    <Card className="sm:col-span-2 lg:col-span-1">
      <CardContent className="space-y-3 p-4">
        {venues.length > 1 && (
          <div className="space-y-1.5">
            <Label className="text-xs">Venue</Label>
            <Select value={venueId} onValueChange={(v) => setVenueId(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) => venues.find((x) => x.id === v)?.name ?? 'Select venue'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {venues.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
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
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">QR scan link (optional)</Label>
          <Input
            type="url"
            value={qrUrl}
            onChange={(e) => setQrUrl(e.target.value)}
            placeholder="https://your-site.com/menu"
          />
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

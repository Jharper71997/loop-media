import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ImageOff } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { DeleteButton } from '@/components/admin/DeleteButton'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDateTime, timeAgo } from '@/lib/format'
import type { Tv } from '@/lib/db.types'
import { RegenerateButton } from '../RegenerateButton'
import { deleteTv } from '../actions'
import { TvLoopControls, RemovePlacementButton, AddPlacement } from './TvControls'

const STATUS_VARIANT = {
  online: 'default',
  offline: 'destructive',
  unpaired: 'secondary',
} as const

type TvFull = Tv & {
  venue: { id: string; name: string; territory_id: string } | null
}

export default async function TvDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params
  const supabase = await createClient()

  const { data: tvData } = await supabase
    .from('tvs')
    .select('*, venue:venues(id, name, territory_id)')
    .eq('id', id)
    .maybeSingle()
  if (!tvData) notFound()
  const tv = tvData as unknown as TvFull

  const maxSlots = Math.max(1, Math.floor(tv.loop_length_seconds / tv.slot_seconds))

  // Current loop: active placements in slot order.
  const { data: plData } = await supabase
    .from('ad_placements')
    .select('id, slot_position, ad:ads(id, title, creative_type, creative_url, status, owner_user_id)')
    .eq('tv_id', id)
    .eq('status', 'active')
    .order('slot_position')
  type PRow = {
    id: string
    slot_position: number
    ad: {
      id: string
      title: string
      creative_type: 'video' | 'image'
      creative_url: string | null
      status: string
      owner_user_id: string
    } | null
  }
  const placements = (plData ?? []) as unknown as PRow[]

  // Advertiser names for the playing ads.
  const ownerIds = [...new Set(placements.map((p) => p.ad?.owner_user_id).filter((x): x is string => !!x))]
  const ownerName = new Map<string, string>()
  if (ownerIds.length) {
    const { data: owners } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', ownerIds)
    for (const o of owners ?? []) ownerName.set(o.id, o.full_name ?? o.email)
  }

  // Candidate ads to add manually: approved/active ads in this venue's market not
  // already on this screen.
  const onScreen = new Set(placements.map((p) => p.ad?.id).filter(Boolean))
  let candidates: { id: string; label: string }[] = []
  if (tv.venue?.territory_id) {
    const { data: ads } = await supabase
      .from('ads')
      .select('id, title')
      .eq('territory_id', tv.venue.territory_id)
      .in('status', ['approved', 'active'])
      .order('title')
    candidates = (ads ?? [])
      .filter((a) => !onScreen.has(a.id))
      .map((a) => ({ id: a.id, label: a.title }))
  }

  const used = placements.length
  const open = Math.max(0, maxSlots - used)

  return (
    <>
      <PageHeader
        title={tv.venue?.name ?? 'Screen'}
        description="Screen detail"
        action={
          <div className="flex gap-1">
            <RegenerateButton id={tv.id} />
            <DeleteButton id={tv.id} action={deleteTv} />
          </div>
        }
      />

      <div className="space-y-6 p-6">
        <Link
          href="/admin/tvs"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> All TVs
        </Link>

        {/* Status + pairing */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Status</p>
              <div className="mt-1">
                <Badge variant={STATUS_VARIANT[tv.status]}>{tv.status}</Badge>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Pairing code</p>
              <code className="mt-1 inline-block rounded bg-muted px-2 py-1 font-mono text-sm">
                {tv.pairing_code ?? '—'}
              </code>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Last heartbeat</p>
              <p className="mt-1 font-medium">{timeAgo(tv.last_heartbeat_at)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Slot fill</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {used}/{maxSlots}
              </p>
              <p className="text-xs text-muted-foreground">{open} open</p>
            </CardContent>
          </Card>
        </div>

        <p className="text-xs text-muted-foreground">
          Device {tv.device_id ?? 'not paired'} · Last sync {formatDateTime(tv.last_sync_at)} ·
          Created {formatDateTime(tv.created_at)}
        </p>

        {/* Loop config */}
        <Card>
          <CardContent className="space-y-3 p-5">
            <p className="text-sm font-medium">Loop configuration</p>
            <TvLoopControls
              id={tv.id}
              loopLength={tv.loop_length_seconds}
              slotSeconds={tv.slot_seconds}
            />
          </CardContent>
        </Card>

        {/* Current loop */}
        <Card>
          <CardContent className="space-y-4 p-5">
            <p className="text-sm font-medium">Now playing ({used} of {maxSlots} slots)</p>
            {placements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing is running on this screen yet. Add an approved ad below, or it will fill
                automatically when the placement engine runs.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {placements.map((p) => (
                  <div key={p.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                    <span className="w-10 shrink-0 text-center font-mono text-sm text-muted-foreground">
                      #{p.slot_position}
                    </span>
                    <div className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-black">
                      {p.ad?.creative_url ? (
                        p.ad.creative_type === 'video' ? (
                          <video src={p.ad.creative_url} className="h-full w-full object-contain" muted />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.ad.creative_url} alt={p.ad.title} className="h-full w-full object-contain" />
                        )
                      ) : (
                        <ImageOff className="size-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{p.ad?.title ?? 'Untitled'}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {p.ad ? ownerName.get(p.ad.owner_user_id) ?? '—' : '—'}
                      </p>
                    </div>
                    <RemovePlacementButton id={p.id} tvId={tv.id} />
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-border pt-4">
              <p className="mb-2 text-sm font-medium">Add an ad to this screen</p>
              <AddPlacement tvId={tv.id} ads={candidates} />
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

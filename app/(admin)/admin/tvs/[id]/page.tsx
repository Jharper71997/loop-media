import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ImageOff } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { DeleteButton } from '@/components/admin/DeleteButton'
import { Card, CardContent } from '@/components/ui/card'
import { formatDateTime, timeAgo, formatNumber } from '@/lib/format'
import { LiveStatus } from '@/components/app/LiveStatus'
import { AutoRefresh } from '@/components/app/AutoRefresh'
import type { Tv } from '@/lib/db.types'
import { RegenerateButton } from '../RegenerateButton'
import { deleteTv } from '../actions'
import { TvLoopControls, RemovePlacementButton, AddPlacement } from './TvControls'

type TvFull = Tv & {
  venue: { id: string; name: string; territory_id: string } | null
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${seconds}s`
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

  // ---- proof of play: uptime today + ad plays today/this month ----
  const todayStr = new Date().toISOString().slice(0, 10)
  const monthStart = todayStr.slice(0, 8) + '01'
  const [{ data: up }, { data: plays }] = await Promise.all([
    supabase.from('tv_uptime_days').select('seconds').eq('tv_id', id).eq('day', todayStr).maybeSingle(),
    supabase.from('ad_plays').select('ad_id, played_at').eq('tv_id', id).gte('played_at', monthStart),
  ])
  const uptimeToday = (up as { seconds: number } | null)?.seconds ?? 0
  const playRows = (plays ?? []) as { ad_id: string; played_at: string }[]
  const byAd = new Map<string, { today: number; month: number }>()
  for (const p of playRows) {
    const e = byAd.get(p.ad_id) ?? { today: 0, month: 0 }
    e.month += 1
    if (p.played_at.slice(0, 10) === todayStr) e.today += 1
    byAd.set(p.ad_id, e)
  }
  const playsTodayTotal = playRows.filter((p) => p.played_at.slice(0, 10) === todayStr).length
  // Titles for any ad that has plays (may include ads no longer on the loop).
  const playAdIds = [...byAd.keys()]
  const adTitle = new Map<string, string>()
  for (const p of placements) if (p.ad) adTitle.set(p.ad.id, p.ad.title)
  const missingTitles = playAdIds.filter((aid) => !adTitle.has(aid))
  if (missingTitles.length) {
    const { data: titleRows } = await supabase.from('ads').select('id, title').in('id', missingTitles)
    for (const a of titleRows ?? []) adTitle.set(a.id, a.title)
  }
  const playList = playAdIds
    .map((aid) => ({ id: aid, title: adTitle.get(aid) ?? 'Ad', ...byAd.get(aid)! }))
    .sort((a, b) => b.month - a.month)

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

      <div className="space-y-6 p-5 md:p-6">
        <AutoRefresh seconds={20} />
        <Link
          href="/admin/tvs"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> All TVs
        </Link>

        {/* Status + live metrics */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Status</p>
              <div className="mt-2">
                <LiveStatus
                  lastHeartbeat={tv.last_heartbeat_at}
                  paired={!!tv.device_id}
                  adsRunning={used}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Last seen {timeAgo(tv.last_heartbeat_at)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">On today</p>
              <p className="mt-1 font-heading text-2xl font-bold tabular-nums">
                {formatDuration(uptimeToday)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Ads shown today</p>
              <p className="mt-1 font-heading text-2xl font-bold tabular-nums">
                {formatNumber(playsTodayTotal)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Slot fill</p>
              <p className="mt-1 font-heading text-2xl font-bold tabular-nums">
                {used}/{maxSlots}
              </p>
              <p className="text-xs text-muted-foreground">
                {open} open · code{' '}
                <code className="rounded bg-muted px-1 font-mono">{tv.pairing_code ?? '—'}</code>
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Plays per ad */}
        <Card>
          <CardContent className="space-y-3 p-5">
            <p className="text-sm font-medium">Times shown per ad</p>
            {playList.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No plays logged yet. Counts appear here as the screen runs the loop.
              </p>
            ) : (
              <div className="space-y-2">
                {playList.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5"
                  >
                    <span className="min-w-0 truncate font-medium">{p.title}</span>
                    <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                      <span className="font-medium text-foreground">{formatNumber(p.today)}</span> today
                      {' · '}
                      <span className="font-medium text-foreground">{formatNumber(p.month)}</span> this
                      month
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

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
                      {p.ad?.owner_user_id ? (
                        <Link
                          href={`/admin/advertisers/${p.ad.owner_user_id}`}
                          className="truncate block text-sm text-primary hover:underline"
                        >
                          {ownerName.get(p.ad.owner_user_id) ?? 'View advertiser'}
                        </Link>
                      ) : (
                        <p className="truncate text-sm text-muted-foreground">—</p>
                      )}
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

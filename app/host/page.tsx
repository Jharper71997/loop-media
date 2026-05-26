import Link from 'next/link'
import { Tv as TvIcon, MapPin, Megaphone, Wifi, WifiOff, PlugZap } from 'lucide-react'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatNumber, timeAgo } from '@/lib/format'
import type { Tv, Venue } from '@/lib/db.types'

type VenueWithTvs = Venue & {
  tvs: Tv[]
  category: { name: string } | null
}

type RunningPlacement = {
  id: string
  slot_position: number
  tv: { venue: { name: string } | null } | null
  ad: { title: string; creative_type: string; owner_kind: string } | null
}

const PROMO_SLOTS = 3

function tvStatusBadge(status: Tv['status']) {
  switch (status) {
    case 'online':
      return { label: 'Online', cls: 'bg-emerald-600', Icon: Wifi }
    case 'offline':
      return { label: 'Offline', cls: 'bg-zinc-600', Icon: WifiOff }
    default:
      return { label: 'Not paired', cls: 'bg-amber-600', Icon: PlugZap }
  }
}

export default async function HostHome() {
  const profile = await requireProfile()
  const supabase = await createClient()

  const { data: venuesData } = await supabase
    .from('venues')
    .select('*, tvs(*), category:categories(name)')
    .eq('host_user_id', profile.id)
    .order('name')
  const venues = (venuesData ?? []) as unknown as VenueWithTvs[]

  const tvIds = venues.flatMap((v) => v.tvs.map((t) => t.id))

  let running: RunningPlacement[] = []
  if (tvIds.length) {
    const { data: placementsData } = await supabase
      .from('ad_placements')
      .select(
        'id, slot_position, tv:tvs(venue:venues(name)), ad:ads(title, creative_type, owner_kind)'
      )
      .in('tv_id', tvIds)
      .neq('status', 'ended')
      .order('slot_position')
    running = (placementsData ?? []) as unknown as RunningPlacement[]
  }

  // Host promos used = non-rejected ads the host owns (matches the DB 3-slot cap).
  const { count: promosUsed } = await supabase
    .from('ads')
    .select('id', { count: 'exact', head: true })
    .eq('owner_user_id', profile.id)
    .eq('owner_kind', 'host')
    .neq('status', 'rejected')

  const allTvs = venues.flatMap((v) => v.tvs)
  const onlineCount = allTvs.filter((t) => t.status === 'online').length
  const totalTraffic = venues.reduce((s, v) => s + (v.foot_traffic_estimate ?? 0), 0)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your venue</h1>
        <p className="text-sm text-muted-foreground">
          Screen status, what&apos;s playing right now, and your free promo slots.
        </p>
      </div>

      {venues.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No venue is linked to your account yet. Once Loop Media sets up your screen,
            it&apos;ll show up here. Reach out to your Loop Media contact if this looks wrong.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Screens online</p>
                <p className="text-2xl font-semibold">
                  {onlineCount}
                  <span className="text-base font-normal text-muted-foreground">
                    {' '}
                    / {allTvs.length}
                  </span>
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Est. monthly foot traffic</p>
                <p className="text-2xl font-semibold">{formatNumber(totalTraffic)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Promo slots used</p>
                <p className="text-2xl font-semibold">
                  {promosUsed ?? 0}
                  <span className="text-base font-normal text-muted-foreground">
                    {' '}
                    / {PROMO_SLOTS}
                  </span>
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Venues + screens */}
          <section className="space-y-4">
            {venues.map((v) => (
              <Card key={v.id}>
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="font-medium">{v.name}</h2>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3" /> {v.address ?? 'Address on file'}
                        {v.category?.name && <span>· {v.category.name}</span>}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      ~{formatNumber(v.foot_traffic_estimate ?? 0)} visitors/mo
                    </span>
                  </div>

                  <div className="mt-4 space-y-2">
                    {v.tvs.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No screens set up here yet.</p>
                    ) : (
                      v.tvs.map((t) => {
                        const b = tvStatusBadge(t.status)
                        return (
                          <div
                            key={t.id}
                            className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                          >
                            <div className="flex items-center gap-2 text-sm">
                              <TvIcon className="size-4 text-muted-foreground" />
                              <span>
                                {t.status === 'unpaired' && t.pairing_code ? (
                                  <>
                                    Pairing code{' '}
                                    <code className="rounded bg-muted px-1 py-0.5 font-mono">
                                      {t.pairing_code}
                                    </code>
                                  </>
                                ) : (
                                  `Last check-in ${timeAgo(t.last_heartbeat_at)}`
                                )}
                              </span>
                            </div>
                            <Badge className={cn('gap-1', b.cls)}>
                              <b.Icon className="size-3" />
                              {b.label}
                            </Badge>
                          </div>
                        )
                      })
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>

          {/* Now playing */}
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Now playing on your screens</h2>
            <Card>
              <CardContent className="p-5">
                {running.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No ads are running on your screens yet. As advertisers book your market,
                    their spots appear here.
                  </p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {running.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2">
                          {p.ad?.owner_kind === 'host' && (
                            <Megaphone className="size-3.5 text-primary" />
                          )}
                          {p.ad?.title ?? 'Ad'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {p.tv?.venue?.name ?? '—'} · slot {p.slot_position}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>

          {/* Promo CTA */}
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5">
            <div className="text-sm">
              <p className="font-medium">Promote your own venue — free</p>
              <p className="text-muted-foreground">
                You get {PROMO_SLOTS} slots to run your own promos on your screens at no cost.
              </p>
            </div>
            <Link href="/host/promos" className={cn(buttonVariants(), 'shrink-0')}>
              <Megaphone className="size-4" /> Manage promos
            </Link>
          </section>
        </>
      )}
    </div>
  )
}

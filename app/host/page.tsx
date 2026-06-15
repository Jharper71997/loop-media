import Link from 'next/link'
import { headers } from 'next/headers'
import { Tv as TvIcon, MapPin, Megaphone, Percent, Plus } from 'lucide-react'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { timeAgo, isTvLive } from '@/lib/format'
import type { Tv, Venue } from '@/lib/db.types'
import { OnboardingTour } from '@/components/app/OnboardingTour'
import { LiveStatus } from '@/components/app/LiveStatus'
import { AutoRefresh } from '@/components/app/AutoRefresh'
import { AddScreenButton } from './AddScreenButton'
import { TvSetupSteps } from './TvSetupSteps'

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

const PROMO_SLOTS = 2

export default async function HostHome() {
  const profile = await requireProfile()
  const supabase = await createClient()

  // Build the /tv link from the domain the host is actually on, at runtime, so
  // it's always correct regardless of NEXT_PUBLIC_APP_URL (which is frozen at
  // build time and easy to leave stale across renames/redeploys).
  const h = await headers()
  const host = h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const tvUrl = host ? `${proto}://${host}/tv` : `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/tv`

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
  const onlineCount = allTvs.filter((t) => isTvLive(t.last_heartbeat_at)).length

  return (
    <div className="space-y-8">
      <OnboardingTour role="host" />
      <AutoRefresh seconds={20} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            {venues.length > 1 ? 'Your venues' : 'Your venue'}
          </h1>
          <p className="text-sm text-muted-foreground">
            Screen status, what&apos;s playing right now, and your free promo slots.
          </p>
        </div>
        {venues.length > 0 && (
          <Link href="/host/register" className={cn(buttonVariants({ variant: 'outline' }), 'shrink-0')}>
            <Plus className="size-4" /> Add another location
          </Link>
        )}
      </div>

      {venues.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No venue is linked to your account yet. Register your space to run the loop on your
              own TV, you&apos;ll also unlock 2 free promo slots.
            </p>
            <Link href="/host/register" className={buttonVariants()}>
              <MapPin className="size-4" /> Register your venue
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="grid gap-4 sm:grid-cols-2">
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
                    <AddScreenButton venueId={v.id} />
                  </div>

                  <div className="mt-4 space-y-2">
                    {v.tvs.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No screens set up here yet. Add one to get a pairing code.
                      </p>
                    ) : (
                      v.tvs.map((t) =>
                        !t.device_id && t.pairing_code ? (
                          <div key={t.id} className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                                <TvIcon className="size-4" /> New screen, not paired yet
                              </span>
                              <LiveStatus lastHeartbeat={t.last_heartbeat_at} paired={false} />
                            </div>
                            <TvSetupSteps code={t.pairing_code} tvUrl={tvUrl} />
                          </div>
                        ) : (
                          <div
                            key={t.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                          >
                            <div className="flex items-center gap-2 text-sm">
                              <TvIcon className="size-4 text-muted-foreground" />
                              <span>{`Last check-in ${timeAgo(t.last_heartbeat_at)}`}</span>
                            </div>
                            <LiveStatus lastHeartbeat={t.last_heartbeat_at} paired={!!t.device_id} />
                          </div>
                        )
                      )
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

          {/* Advertise elsewhere — host discount */}
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/30 bg-primary/5 p-5">
            <div className="flex items-start gap-3 text-sm">
              <Percent className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="font-medium">Advertise across the whole network — 20% off</p>
                <p className="text-muted-foreground">
                  Your hardware is part of Loop Network, so you get 20% off every screen on the map.
                  The discount is applied automatically at checkout.
                </p>
              </div>
            </div>
            <Link href="/advertiser/browse" className={cn(buttonVariants(), 'shrink-0')}>
              <MapPin className="size-4" /> Buy ads on other screens
            </Link>
          </section>
        </>
      )}
    </div>
  )
}

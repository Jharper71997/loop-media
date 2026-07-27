import Link from 'next/link'
import { Tv as TvIcon, MapPin, Megaphone, Percent, Plus, Pencil, Store } from 'lucide-react'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { HOST_COMP_MAX_SCREENS } from '@/lib/hostComp'
import { timeAgo, isTvLive, formatNumber } from '@/lib/format'
import type { Tv, Venue } from '@/lib/db.types'
import { LiveStatus } from '@/components/app/LiveStatus'
import { AutoRefresh } from '@/components/app/AutoRefresh'
import { RemoveLocationButton } from './RemoveLocationButton'
import { TvSetupSteps } from './TvSetupSteps'

type VenueWithTvs = Venue & {
  tvs: Tv[]
  category: { name: string } | null
}

type RunningPlacement = {
  id: string
  slot_position: number
  status: string
  tv: { venue: { id: string; name: string } | null } | null
  ad: { title: string; creative_type: string; owner_kind: string } | null
}

export default async function HostHome() {
  const profile = await requireProfile()
  const isDemo = profile.is_demo
  const supabase = await createClient()

  const { data: venuesData } = await supabase
    .from('venues')
    .select('*, tvs(*), category:categories(name)')
    .eq('host_user_id', profile.id)
    .order('name')
  const venues = (venuesData ?? []) as unknown as VenueWithTvs[]

  // The host's 100%-off advertising comp code, minted when a venue goes live.
  const compCode =
    venues.find((v) => v.status === 'active' && v.comp_promo_code)?.comp_promo_code ?? null

  const tvIds = venues.flatMap((v) => v.tvs.map((t) => t.id))

  let running: RunningPlacement[] = []
  if (tvIds.length) {
    const { data: placementsData } = await supabase
      .from('ad_placements')
      .select(
        'id, slot_position, status, tv:tvs(venue:venues(id, name)), ad:ads(title, creative_type, owner_kind)'
      )
      .in('tv_id', tvIds)
      .neq('status', 'ended')
      .order('slot_position')
    running = (placementsData ?? []) as unknown as RunningPlacement[]
  }

  // Per-venue count of ACTIVE paid advertiser ads (not the host's own promos).
  // Removing a location is blocked while any are running (the server enforces it
  // too); the dashboard shows this instead of an enabled Remove button.
  const paidAdsByVenue = new Map<string, number>()
  for (const p of running) {
    const vid = p.tv?.venue?.id
    if (vid && p.status === 'active' && p.ad?.owner_kind === 'advertiser') {
      paidAdsByVenue.set(vid, (paidAdsByVenue.get(vid) ?? 0) + 1)
    }
  }

  // This host's own paid campaigns running on OTHER venues' screens (they
  // advertise from /host/advertise). Surfaced so they manage it without leaving.
  const { data: myCampaignsData } = await supabase
    .from('campaigns')
    .select('id, status, ad:ads(title, owner_kind)')
    .eq('advertiser_id', profile.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(6)
  type MyCampaign = {
    id: string
    status: string
    ad: { title: string | null; owner_kind: string } | null
  }
  // A host's free own-screen promos are also campaigns owned by them; keep those
  // out of the "on other screens" list — they're managed on /host/promote.
  const myCampaigns = ((myCampaignsData ?? []) as unknown as MyCampaign[]).filter(
    (c) => c.ad?.owner_kind !== 'host'
  )

  const allTvs = venues.flatMap((v) => v.tvs)
  const onlineCount = allTvs.filter((t) => isTvLive(t.last_heartbeat_at)).length

  // Performance at their venues over the last 30 days: real QR scans driven,
  // measured ad plays, and trivia players. Counted with the admin client scoped to
  // THIS host's own venue/screen ids (which we already loaded above), so the
  // numbers are correct regardless of per-table RLS on aggregate reads.
  const venueIds = venues.map((v) => v.id)
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 30)
  const sinceIso = since.toISOString()
  let scans30 = 0
  let plays30 = 0
  let trivia30 = 0
  if (venueIds.length) {
    const adminRead = createAdminClient()
    const [scanRes, triviaRes, playRes] = await Promise.all([
      adminRead
        .from('qr_scans')
        .select('id', { count: 'exact', head: true })
        .in('venue_id', venueIds)
        .eq('is_bot', false)
        .gte('scanned_at', sinceIso),
      adminRead
        .from('trivia_players')
        .select('id', { count: 'exact', head: true })
        .in('venue_id', venueIds)
        .gte('created_at', sinceIso),
      tvIds.length
        ? adminRead
            .from('ad_plays')
            .select('id', { count: 'exact', head: true })
            .in('tv_id', tvIds)
            .gte('played_at', sinceIso)
        : Promise.resolve({ count: 0 }),
    ])
    scans30 = scanRes.count ?? 0
    trivia30 = triviaRes.count ?? 0
    plays30 = playRes.count ?? 0
  }

  // Demo: the venue was just created this second, so real analytics are empty.
  // Show believable sample activity + a few ads "now playing" so the dashboard
  // reads as a live, earning screen for the walkthrough. All of it is confined to
  // the demo account (is_demo) and never touches real numbers or real TVs.
  if (isDemo) {
    scans30 = 342
    plays30 = 12480
    trivia30 = 86
    const demoVenue = venues[0]
    if (demoVenue) {
      const v = { id: demoVenue.id, name: demoVenue.name }
      running = [
        { id: 'demo-1', slot_position: 1, status: 'active', tv: { venue: v }, ad: { title: "Joe's Pizza — 2-for-Tuesday", creative_type: 'image', owner_kind: 'advertiser' } },
        { id: 'demo-2', slot_position: 2, status: 'active', tv: { venue: v }, ad: { title: 'Elite Auto Detailing', creative_type: 'video', owner_kind: 'advertiser' } },
        { id: 'demo-3', slot_position: 3, status: 'active', tv: { venue: v }, ad: { title: 'Northside Dental — New Patient Special', creative_type: 'image', owner_kind: 'advertiser' } },
      ]
    }
  }

  return (
    <div className="space-y-8">
      <AutoRefresh seconds={20} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div data-tour="host-overview">
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            {venues.length > 1 ? 'Your venues' : 'Your venue'}
          </h1>
          <p className="text-sm text-muted-foreground">
            Screen status, what&apos;s playing right now, and your advertising perks.
          </p>
        </div>
        {venues.length > 0 && (
          <Link
            href="/host/register"
            data-tour="host-register"
            className={cn(buttonVariants({ variant: 'outline' }), 'shrink-0')}
          >
            <Plus className="size-4" /> Add another location
          </Link>
        )}
      </div>

      {venues.length === 0 ? (
        <Card data-tour="host-register">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No venue is linked to your account yet. Register your space to run the loop on your
              own TV — once it&apos;s live, you can advertise across the network for free.
            </p>
            <Link href="/host/register" className={buttonVariants()}>
              <MapPin className="size-4" /> Register your venue
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Performance at your venues — what a screen is actually driving, so
              hosting reads as worth it rather than a black box. */}
          <div data-tour="host-stats" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Screens online</p>
                <p className="text-2xl font-semibold tabular-nums">
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
                <p className="text-sm text-muted-foreground">QR scans from your screens · 30d</p>
                <p className="text-2xl font-semibold tabular-nums text-primary">
                  {formatNumber(scans30)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Ads played · 30d</p>
                <p className="text-2xl font-semibold tabular-nums">{formatNumber(plays30)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Trivia players · 30d</p>
                <p className="text-2xl font-semibold tabular-nums">{formatNumber(trivia30)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Venues + screens */}
          <section data-tour="host-screens" className="space-y-4">
            {venues.map((v) => (
              <Card key={v.id}>
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {/* Logo the host set — the same one advertisers see on the map. */}
                      <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-muted/40">
                        {v.logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={v.logo_url} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                        ) : (
                          <Store className="size-5 text-muted-foreground" />
                        )}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-medium">{v.name}</h2>
                          {v.status !== 'active' && (
                            <Badge variant="warning">Pending review</Badge>
                          )}
                        </div>
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="size-3" /> {v.address ?? 'Address on file'}
                          {v.category?.name && <span>· {v.category.name}</span>}
                        </p>
                        {v.status !== 'active' && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            We&apos;re reviewing your venue — we&apos;ll reach out to schedule your
                            Fire Stick setup; paid ads start running once it&apos;s approved.
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Link
                        href={`/host/venues/${v.id}/edit`}
                        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                      >
                        <Pencil className="size-4" /> Edit details
                      </Link>
                      <RemoveLocationButton
                        venueId={v.id}
                        paidAdCount={paidAdsByVenue.get(v.id) ?? 0}
                      />
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    {v.tvs.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Your screen is being set up.
                      </p>
                    ) : (
                      v.tvs.map((t) => {
                        const paired = !!t.device_id
                        return (
                          <div key={t.id} className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                                <TvIcon className="size-4" />
                                {paired
                                  ? `Last check-in ${timeAgo(t.last_heartbeat_at)}`
                                  : 'Screen not live yet'}
                              </span>
                              <LiveStatus lastHeartbeat={t.last_heartbeat_at} paired={paired} />
                            </div>
                            <TvSetupSteps paired={paired} pairingCode={t.pairing_code} />
                          </div>
                        )
                      })
                    )}
                  </div>

                  {v.status === 'active' && v.comp_promo_code && (
                    <div data-tour="host-perk" className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-2 text-sm">
                          <Megaphone className="mt-0.5 size-4 shrink-0 text-primary" />
                          <div>
                            <p className="font-medium">Advertise free — your host perk</p>
                            <p className="text-muted-foreground">
                              Your code{' '}
                              <span className="font-mono font-semibold text-foreground">
                                {v.comp_promo_code}
                              </span>{' '}
                              covers up to {HOST_COMP_MAX_SCREENS} screens and applies itself at
                              checkout for 100% off. Nothing to type.
                            </p>
                          </div>
                        </div>
                        <Link
                          href="/host/advertise"
                          className={cn(buttonVariants({ size: 'sm' }), 'shrink-0')}
                        >
                          Advertise
                        </Link>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </section>

          {/* Put your own promo on your own screen — free host perk */}
          {venues.some((v) => v.status === 'active' && v.tvs.length > 0) && (
            <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/30 bg-primary/5 p-5">
              <div className="flex items-start gap-3 text-sm">
                <Megaphone className="mt-0.5 size-5 shrink-0 text-primary" />
                <div>
                  <p className="font-medium">Put your own promo on your screen — free</p>
                  <p className="text-muted-foreground">
                    Run your own image or video (happy hour, an event, a special) on your own TV. It
                    plays in the loop within about 30 seconds — no charge.
                  </p>
                </div>
              </div>
              <Link href="/host/promote" className={cn(buttonVariants(), 'shrink-0')}>
                <Plus className="size-4" /> Add a promo
              </Link>
            </section>
          )}

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

          {/* Your ads running on other venues' screens */}
          {myCampaigns.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium">Your campaigns on other screens</h2>
              <Card>
                <CardContent className="p-2">
                  <ul className="divide-y divide-border">
                    {myCampaigns.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/host/advertise/campaigns/${c.id}`}
                          className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm transition hover:bg-muted/50"
                        >
                          <span className="min-w-0 truncate font-medium">
                            {c.ad?.title ?? 'Campaign'}
                          </span>
                          <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                            <span className="capitalize">{c.status}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </section>
          )}

          {/* Advertise on other screens — host discount. Hidden once the host has
              a 100%-off comp code (that card covers it). */}
          {!compCode && (
            <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/30 bg-primary/5 p-5">
              <div className="flex items-start gap-3 text-sm">
                <Percent className="mt-0.5 size-5 shrink-0 text-primary" />
                <div>
                  <p className="font-medium">Advertise across the whole network — 20% off</p>
                  <p className="text-muted-foreground">
                    Your hardware is part of Loop Network, so you get 20% off every screen on the
                    map. The discount is applied automatically at checkout.
                  </p>
                </div>
              </div>
              <Link href="/host/advertise" className={cn(buttonVariants(), 'shrink-0')}>
                <MapPin className="size-4" /> Advertise on other screens
              </Link>
            </section>
          )}
        </>
      )}
    </div>
  )
}

import Link from 'next/link'
import { Plus, ImageOff, Lock, Gift, Sparkles, MapPin, Trash2, Archive, Rocket } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requireProfile } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatCents, formatNumber, isTvLive } from '@/lib/format'
import { cn } from '@/lib/utils'
import { loyaltyCredits } from '@/lib/pricing'
import { resolveAdvertiserContext } from '@/lib/pricing.server'
import { PERF_WINDOW_DAYS } from '@/lib/analytics'
import { MoneyStat } from '@/components/app/MoneyStat'
import { OnboardingTour } from '@/components/app/OnboardingTour'
import AdsMap, { type AdsMapVenue } from './AdsMap'

type CampaignRow = {
  id: string
  monthly_total_cents: number | null
  status: string
  created_at: string
  ad: {
    id: string
    title: string
    status: string
    creative_type: 'video' | 'image'
    creative_url: string | null
    rejection_reason: string | null
  } | null
  targets: { count: number }[] | null
  subscription: { status: string }[] | null
}

function statusLabel(c: CampaignRow): {
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
  hint?: string
} {
  if (c.ad?.status === 'rejected') return { label: 'Rejected', variant: 'destructive' }
  if (c.ad?.status === 'pending') return { label: 'Pending review', variant: 'secondary' }
  if (c.status === 'active') return { label: 'Active', variant: 'default' }
  if (c.status === 'paused') return { label: 'Paused', variant: 'outline' }
  if (c.status === 'canceled') return { label: 'Canceled', variant: 'destructive' }
  // Draft — give a specific reason so advertisers know what to do next
  const sub = c.subscription?.[0]?.status
  if (!sub || sub === 'incomplete')
    return { label: 'Payment needed', variant: 'outline', hint: 'Finish checkout to go live' }
  if (sub === 'past_due')
    return { label: 'Payment past due', variant: 'destructive', hint: 'Update your payment method' }
  if (!c.ad?.creative_url)
    return { label: 'Missing creative', variant: 'outline', hint: 'Upload your ad to continue' }
  return { label: 'Draft', variant: 'secondary' }
}

// Dashboard metric tile (slightly lifted card so the strip reads as a unit).
function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 px-4 py-3.5">
      <MoneyStat label={label} value={value} />
    </div>
  )
}

export default async function AdvertiserDashboard({
  searchParams,
}: {
  searchParams: Promise<{ membership?: string }>
}) {
  const { membership } = await searchParams
  const profile = await requireProfile()
  const supabase = await createClient()
  const [{ data }, { count: trashedCount }, { count: archivedCount }, ctx] = await Promise.all([
    supabase
      .from('campaigns')
      .select(
        '*, ad:ads(id, title, status, creative_type, creative_url, rejection_reason), targets:campaign_targets(count), subscription:subscriptions(status)'
      )
      .is('deleted_at', null)
      .is('archived_at', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('campaigns')
      .select('id', { count: 'exact', head: true })
      .is('archived_at', null)
      .not('deleted_at', 'is', null),
    supabase
      .from('campaigns')
      .select('id', { count: 'exact', head: true })
      .not('archived_at', 'is', null),
    resolveAdvertiserContext(profile.id),
  ])
  const campaigns = (data ?? []) as CampaignRow[]

  // title + live(=campaign active) per campaign, for the venue list + map.
  const campaignMeta = new Map(
    campaigns.map((c) => [c.id, { title: c.ad?.title ?? 'Your ad', live: c.status === 'active' }])
  )
  const adIds = [...new Set(campaigns.map((c) => c.ad?.id).filter(Boolean) as string[])]

  // eslint-disable-next-line react-hooks/purity -- server component; per-request timestamp is correct here
  const scanCutoff = new Date(Date.now() - PERF_WINDOW_DAYS * 86_400_000).toISOString()
  const [placementsRes, scansRes] = await Promise.all([
    campaigns.length
      ? supabase
          .from('ad_placements')
          .select(
            'campaign_id, tv:tvs(id, last_heartbeat_at, venue:venues(id, name, city, state, lat, lng, foot_traffic_estimate))'
          )
          .in('campaign_id', [...campaignMeta.keys()])
          .neq('status', 'ended')
      : Promise.resolve({ data: [] as unknown[] }),
    adIds.length
      ? supabase
          .from('qr_scans')
          .select('id', { count: 'exact', head: true })
          .in('ad_id', adIds)
          .gte('scanned_at', scanCutoff)
      : Promise.resolve({ count: 0 }),
  ])
  const scans30d = (scansRes as { count: number | null }).count ?? 0

  type PRow = {
    campaign_id: string | null
    tv: {
      id: string
      last_heartbeat_at: string | null
      venue: {
        id: string
        name: string
        city: string | null
        state: string | null
        lat: number | null
        lng: number | null
        foot_traffic_estimate: number
      } | null
    } | null
  }
  type VenueAgg = {
    id: string
    name: string
    city: string | null
    state: string | null
    lat: number | null
    lng: number | null
    footTraffic: number
    live: boolean // a screen here is checked in right now
    hasActive: boolean // an active campaign of this advertiser runs here
    ads: { title: string; live: boolean }[]
  }
  const byVenue = new Map<string, VenueAgg>()
  for (const p of (((placementsRes as { data: unknown[] }).data ?? []) as PRow[])) {
    const v = p.tv?.venue
    if (!v) continue
    const meta = p.campaign_id ? campaignMeta.get(p.campaign_id) : null
    const a: VenueAgg =
      byVenue.get(v.id) ?? {
        id: v.id,
        name: v.name,
        city: v.city,
        state: v.state,
        lat: v.lat,
        lng: v.lng,
        footTraffic: v.foot_traffic_estimate ?? 0,
        live: false,
        hasActive: false,
        ads: [],
      }
    if (isTvLive(p.tv?.last_heartbeat_at ?? null)) a.live = true
    if (meta) {
      if (!a.ads.some((x) => x.title === meta.title && x.live === meta.live)) a.ads.push(meta)
      if (meta.live) {
        a.hasActive = true
      }
    }
    byVenue.set(v.id, a)
  }

  const allVenues = [...byVenue.values()]
  const mapVenues: AdsMapVenue[] = allVenues.map((v) => ({
    id: v.id,
    name: v.name,
    lat: v.lat,
    lng: v.lng,
    ads: v.ads,
  }))
  const geoVenues = mapVenues.filter((v) => v.lat != null && v.lng != null)
  const center: [number, number] = geoVenues.length
    ? [
        geoVenues.reduce((s, v) => s + (v.lat as number), 0) / geoVenues.length,
        geoVenues.reduce((s, v) => s + (v.lng as number), 0) / geoVenues.length,
      ]
    : [34.7541, -77.4302]

  // The real, named places the ad is actually running (active campaigns) — live first.
  const playingVenues = allVenues
    .filter((v) => v.hasActive)
    .sort((a, b) => Number(b.live) - Number(a.live) || b.footTraffic - a.footTraffic)
  const liveCount = playingVenues.filter((v) => v.live).length

  const monthlySpend = campaigns
    .filter((c) => c.status === 'active')
    .reduce((s, c) => s + (c.monthly_total_cents ?? 0), 0)
  const estReach = playingVenues.reduce((s, v) => s + v.footTraffic, 0)

  const credits = loyaltyCredits({
    monthsActive: ctx.monthsActive,
    screensRunning: ctx.screensRunning,
  })
  const perks: { icon: typeof Lock; label: string }[] = []
  if (credits.rateLocked)
    perks.push({ icon: Lock, label: 'Founding Advertiser — your rates are locked in' })
  if (credits.freeScreens > 0)
    perks.push({
      icon: Gift,
      label: `${credits.freeScreens} free screen${credits.freeScreens === 1 ? '' : 's'} on your next order`,
    })
  if (credits.loyalty12mo)
    perks.push({ icon: Sparkles, label: 'Loyalty bonus — extra 5% off everything' })
  let nextMilestone: string | null = null
  if (ctx.screensRunning < 10)
    nextMilestone = `Reach 10 screens to unlock 2 free (${ctx.screensRunning}/10)`
  else if (ctx.monthsActive < 12)
    nextMilestone = `${12 - ctx.monthsActive} month${12 - ctx.monthsActive === 1 ? '' : 's'} to your 5% loyalty discount`

  const hasCampaigns = campaigns.length > 0

  return (
    <div className="space-y-6">
      <OnboardingTour role="advertiser" />
      {membership === 'success' && (
        <div className="rounded-lg border border-emerald-600/40 bg-emerald-600/10 px-4 py-3 text-sm text-emerald-300">
          You&apos;re in. Unlimited ad changes are now included on your account.
        </div>
      )}
      {membership === 'canceled' && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Membership checkout canceled. You were not charged.
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Your ads</h1>
          <p className="text-sm text-muted-foreground">The real places your ad is running.</p>
        </div>
        {hasCampaigns && (
          <Link href="/advertiser/browse" className={cn(buttonVariants({ size: 'sm' }))}>
            <Plus className="size-4" /> New
          </Link>
        )}
      </div>

      {!hasCampaigns ? (
        // First run: one clear, dominant action.
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-primary/10">
              <Rocket className="size-6 text-primary" />
            </span>
            <div className="space-y-1">
              <h2 className="font-heading text-xl font-bold">Get your ad on local screens</h2>
              <p className="mx-auto max-w-xs text-sm text-muted-foreground">
                Pick the exact spots on a map, upload your ad, and you&apos;re live. You&apos;ll see
                every real place it plays, right here.
              </p>
            </div>
            <Link href="/advertiser/browse" className={cn(buttonVariants({ size: 'lg' }), 'h-12')}>
              <Plus className="size-4" /> Start a campaign
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Command-center roll-up: the paying customer's numbers at a glance. */}
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Locations" value={formatNumber(playingVenues.length)} />
            <StatTile label="Est. reach / mo" value={formatNumber(estReach)} />
            <StatTile label={`Scans · ${PERF_WINDOW_DAYS}d`} value={formatNumber(scans30d)} />
            <StatTile label="Spend / mo" value={formatCents(monthlySpend)} />
          </div>

          {/* The named reality — exactly which venues the ad is in, and which are live. */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-lg font-semibold">Where your ad is playing</h2>
              {playingVenues.length > 0 && (
                <span className="text-xs text-muted-foreground">{liveCount} live now</span>
              )}
            </div>
            {playingVenues.length > 0 ? (
              <div className="space-y-3">
                <Card className="py-0">
                  <CardContent className="divide-y divide-border p-0">
                    {playingVenues.map((v) => (
                      <div
                        key={v.id}
                        className="flex items-center justify-between gap-3 px-4 py-3.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{v.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[v.city, v.state].filter(Boolean).join(', ') || 'Local venue'}
                          </p>
                        </div>
                        {v.live ? (
                          <Badge className="shrink-0 gap-1.5 bg-emerald-600">
                            <span className="size-1.5 rounded-full bg-white" /> Live now
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="shrink-0">
                            Coming online
                          </Badge>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
                {geoVenues.length > 0 && <AdsMap venues={mapVenues} center={center} />}
              </div>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                  <MapPin className="size-6 text-muted-foreground" />
                  <p className="max-w-xs text-sm text-muted-foreground">
                    Your ad isn&apos;t on screens yet. Once it&apos;s approved and paid, every place
                    it plays shows up here.
                  </p>
                </CardContent>
              </Card>
            )}
          </section>

          {(perks.length > 0 || nextMilestone) && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
                {perks.map((p) => (
                  <span key={p.label} className="flex items-center gap-2 text-sm font-medium">
                    <p.icon className="size-4 text-primary" /> {p.label}
                  </span>
                ))}
                {nextMilestone && <span className="text-sm text-muted-foreground">{nextMilestone}</span>}
              </CardContent>
            </Card>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-lg font-semibold">Your campaigns</h2>
              <div className="flex items-center gap-4">
                {(archivedCount ?? 0) > 0 && (
                  <Link
                    href="/advertiser/past"
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <Archive className="size-4" /> Past ({archivedCount})
                  </Link>
                )}
                {(trashedCount ?? 0) > 0 && (
                  <Link
                    href="/advertiser/trash"
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <Trash2 className="size-4" /> Trash ({trashedCount})
                  </Link>
                )}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {campaigns.map((c) => {
                const s = statusLabel(c)
                const screens = c.targets?.[0]?.count ?? 0
                return (
                  <Link key={c.id} href={`/advertiser/campaigns/${c.id}`}>
                    <Card className="overflow-hidden transition hover:border-primary/50">
                      <div className="flex aspect-video items-center justify-center bg-black">
                        {c.ad?.creative_url ? (
                          c.ad.creative_type === 'video' ? (
                            <video
                              src={c.ad.creative_url}
                              className="h-full w-full object-contain"
                              muted
                            />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={c.ad.creative_url}
                              alt={c.ad.title}
                              className="h-full w-full object-contain"
                            />
                          )
                        ) : (
                          <ImageOff className="size-6 text-muted-foreground" />
                        )}
                      </div>
                      <CardContent className="space-y-2 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium">{c.ad?.title ?? 'Untitled'}</span>
                          <Badge
                            variant={s.variant}
                            className={cn(s.label === 'Active' && 'bg-emerald-600')}
                          >
                            {s.label}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {screens} screen{screens === 1 ? '' : 's'}
                          {c.monthly_total_cents != null && (
                            <> · {formatCents(c.monthly_total_cents)}/mo</>
                          )}
                        </div>
                        {c.ad?.status === 'rejected' && c.ad.rejection_reason && (
                          <p className="text-xs text-destructive">Reason: {c.ad.rejection_reason}</p>
                        )}
                        {s.hint && <p className="text-xs text-amber-500">{s.hint}</p>}
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

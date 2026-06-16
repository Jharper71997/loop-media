import Link from 'next/link'
import { Plus, ImageOff, Lock, Gift, Sparkles, MapPin, Trash2, Archive } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requireProfile } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatCents } from '@/lib/format'
import { cn } from '@/lib/utils'
import { loyaltyCredits } from '@/lib/pricing'
import { resolveAdvertiserContext } from '@/lib/pricing.server'
import { OnboardingTour } from '@/components/app/OnboardingTour'
import AdsMap, { type AdsMapVenue } from './AdsMap'

type CampaignRow = {
  id: string
  monthly_total_cents: number | null
  status: string
  created_at: string
  ad: {
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
        '*, ad:ads(title, status, creative_type, creative_url, rejection_reason), targets:campaign_targets(count), subscription:subscriptions(status)'
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

  // Where the advertiser's ads physically are right now — drives the top map.
  const campaignMeta = new Map(
    campaigns.map((c) => [c.id, { title: c.ad?.title ?? 'Untitled', live: c.status === 'active' }])
  )
  let mapVenues: AdsMapVenue[] = []
  if (campaigns.length) {
    const { data: placementsData } = await supabase
      .from('ad_placements')
      .select('campaign_id, tv:tvs(venue:venues(id, name, lat, lng))')
      .in('campaign_id', [...campaignMeta.keys()])
      .neq('status', 'ended')
    type PRow = {
      campaign_id: string | null
      tv: { venue: { id: string; name: string; lat: number | null; lng: number | null } | null } | null
    }
    const byVenue = new Map<string, AdsMapVenue>()
    for (const p of (placementsData ?? []) as unknown as PRow[]) {
      const v = p.tv?.venue
      const meta = p.campaign_id ? campaignMeta.get(p.campaign_id) : null
      if (!v || !meta) continue
      const entry: AdsMapVenue =
        byVenue.get(v.id) ?? { id: v.id, name: v.name, lat: v.lat, lng: v.lng, ads: [] }
      if (!entry.ads.some((a) => a.title === meta.title && a.live === meta.live))
        entry.ads.push({ title: meta.title, live: meta.live })
      byVenue.set(v.id, entry)
    }
    mapVenues = [...byVenue.values()]
  }
  const geoVenues = mapVenues.filter((v) => v.lat != null && v.lng != null)
  const center: [number, number] = geoVenues.length
    ? [
        geoVenues.reduce((s, v) => s + (v.lat as number), 0) / geoVenues.length,
        geoVenues.reduce((s, v) => s + (v.lng as number), 0) / geoVenues.length,
      ]
    : [34.7541, -77.4302]
  const liveVenueCount = geoVenues.filter((v) => v.ads.some((a) => a.live)).length

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
  if (credits.loyalty12mo) perks.push({ icon: Sparkles, label: 'Loyalty bonus — extra 5% off everything' })

  // Next milestone nudge (the "I'm at 9, let me hit 10" pull).
  let nextMilestone: string | null = null
  if (ctx.screensRunning < 10)
    nextMilestone = `Reach 10 screens to unlock 2 free (${ctx.screensRunning}/10)`
  else if (ctx.monthsActive < 12)
    nextMilestone = `${12 - ctx.monthsActive} month${12 - ctx.monthsActive === 1 ? '' : 's'} to your 5% loyalty discount`

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Your ads</h1>
          <p className="text-sm text-muted-foreground">See exactly where your ads are playing.</p>
        </div>
        <Link href="/advertiser/browse" className={buttonVariants()}>
          <Plus className="size-4" /> New campaign
        </Link>
      </div>

      {/* Map first — where the ads physically are */}
      {geoVenues.length > 0 ? (
        <div className="space-y-2">
          <AdsMap venues={mapVenues} center={center} />
          <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full bg-emerald-500" /> Live now
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full bg-gray-400" /> Paused
            </span>
            <span className="ml-auto">
              {liveVenueCount} location{liveVenueCount === 1 ? '' : 's'} live
            </span>
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <MapPin className="size-7 text-muted-foreground" />
            <p className="max-w-xs text-sm text-muted-foreground">
              Once your ad is approved and running, this map shows exactly which screens it&apos;s on.
            </p>
            <Link href="/advertiser/browse" className={buttonVariants()}>
              <Plus className="size-4" /> Pick screens on the map
            </Link>
          </CardContent>
        </Card>
      )}

      {(perks.length > 0 || nextMilestone) && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
            {perks.map((p) => (
              <span key={p.label} className="flex items-center gap-2 text-sm font-medium">
                <p.icon className="size-4 text-primary" /> {p.label}
              </span>
            ))}
            {nextMilestone && (
              <span className="text-sm text-muted-foreground">{nextMilestone}</span>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold">Running now</h2>
        <div className="flex items-center gap-4">
          {(archivedCount ?? 0) > 0 && (
            <Link
              href="/advertiser/past"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <Archive className="size-4" /> Past campaigns ({archivedCount})
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

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-muted-foreground">
              No campaigns yet. Build one off the map in a couple of minutes.
            </p>
            <Link href="/advertiser/browse" className={buttonVariants()}>
              <Plus className="size-4" /> Build a campaign
            </Link>
          </CardContent>
        </Card>
      ) : (
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
                        <video src={c.ad.creative_url} className="h-full w-full object-contain" muted />
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
                      <Badge variant={s.variant} className={cn(s.label === 'Active' && 'bg-emerald-600')}>
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
                    {s.hint && (
                      <p className="text-xs text-amber-500">{s.hint}</p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

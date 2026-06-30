import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ImageOff, Tv as TvIcon } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCents, formatNumber, formatDateTime } from '@/lib/format'
import type { Ad, Campaign, Package, Profile, Subscription } from '@/lib/db.types'
import { CampaignAdminControls } from './CampaignAdminControls'
import { EditAdvertiserDialog } from './EditAdvertiserDialog'

const PERF_WINDOW_DAYS = 30

type CampaignRow = Campaign & {
  ad: Ad | null
  package: Pick<Package, 'name' | 'base_price_cents' | 'screen_cap'> | null
}

type BadgeVariant = 'warning' | 'success' | 'secondary' | 'destructive'

function statusBadge(campaign: CampaignRow): { label: string; variant: BadgeVariant } {
  const adStatus = campaign.ad?.status
  if (adStatus === 'rejected') return { label: 'Ad rejected', variant: 'destructive' }
  if (adStatus === 'pending') return { label: 'Pending review', variant: 'warning' }
  switch (campaign.status) {
    case 'active':
      return { label: 'Active', variant: 'success' }
    case 'paused':
      return { label: 'Paused', variant: 'secondary' }
    case 'canceled':
      return { label: 'Canceled', variant: 'destructive' }
    default:
      return { label: 'Draft', variant: 'secondary' }
  }
}

export default async function AdvertiserDetail({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const { id } = await params
  const supabase = await createClient()

  const { data: advData } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .eq('role', 'advertiser')
    .maybeSingle()
  if (!advData) notFound()
  const advertiser = advData as Profile

  const { data: campData } = await supabase
    .from('campaigns')
    .select('*, ad:ads(*), package:packages(name, base_price_cents, screen_cap)')
    .eq('advertiser_id', id)
    .order('created_at', { ascending: false })
  const campaigns = (campData ?? []) as unknown as CampaignRow[]

  const campaignIds = campaigns.map((c) => c.id)
  const adIds = campaigns.map((c) => c.ad_id).filter((x): x is string => !!x)

  // Subscriptions for this advertiser (mapped by campaign).
  const { data: subData } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('advertiser_id', id)
    .order('created_at', { ascending: false })
  const subs = (subData ?? []) as Subscription[]
  const subByCampaign = new Map<string, Subscription>()
  for (const s of subs) if (s.campaign_id && !subByCampaign.has(s.campaign_id)) subByCampaign.set(s.campaign_id, s)

  // Active placements → distinct screens + distinct venues (for est impressions).
  const screensByCampaign = new Map<string, Set<string>>()
  const venuesByCampaign = new Map<string, Map<string, number>>()
  if (campaignIds.length) {
    const { data: plData } = await supabase
      .from('ad_placements')
      .select('campaign_id, tv:tvs(id, venue:venues(id, foot_traffic_estimate))')
      .in('campaign_id', campaignIds)
      .neq('status', 'ended')
    type PRow = {
      campaign_id: string | null
      tv: { id: string; venue: { id: string; foot_traffic_estimate: number } | null } | null
    }
    for (const p of (plData ?? []) as unknown as PRow[]) {
      if (!p.campaign_id || !p.tv) continue
      const screens = screensByCampaign.get(p.campaign_id) ?? new Set<string>()
      screens.add(p.tv.id)
      screensByCampaign.set(p.campaign_id, screens)
      if (p.tv.venue) {
        const vmap = venuesByCampaign.get(p.campaign_id) ?? new Map<string, number>()
        vmap.set(p.tv.venue.id, p.tv.venue.foot_traffic_estimate ?? 0)
        venuesByCampaign.set(p.campaign_id, vmap)
      }
    }
  }

  // Measured QR scans over the window, counted per ad.
  const scansByAd = new Map<string, number>()
  if (adIds.length) {
    const since = new Date()
    since.setUTCDate(since.getUTCDate() - PERF_WINDOW_DAYS)
    const { data: scanData } = await supabase
      .from('qr_scans')
      .select('ad_id')
      .in('ad_id', adIds)
      .gte('scanned_at', since.toISOString())
    for (const s of scanData ?? []) scansByAd.set(s.ad_id, (scansByAd.get(s.ad_id) ?? 0) + 1)
  }

  // Monthly price per campaign = the cart total frozen at checkout.
  const priceByCampaign = new Map<string, number>()
  for (const c of campaigns) priceByCampaign.set(c.id, c.monthly_total_cents ?? 0)
  const monthlySpend = campaigns
    .filter((c) => c.status === 'active')
    .reduce((sum, c) => sum + (priceByCampaign.get(c.id) ?? 0), 0)

  const totalScans = [...scansByAd.values()].reduce((a, b) => a + b, 0)
  const territoryName = (tid: string | null) =>
    tid ? territory.territories.find((x) => x.id === tid)?.name ?? '—' : '—'

  return (
    <>
      <PageHeader
        title={advertiser.full_name ?? advertiser.email}
        description={advertiser.email}
        action={
          <EditAdvertiserDialog
            id={advertiser.id}
            fullName={advertiser.full_name}
            phone={advertiser.phone}
            territoryId={advertiser.territory_id}
            territories={territory.territories.map((t) => ({ id: t.id, name: t.name }))}
          />
        }
      />

      <div className="space-y-6 p-6">
        <Link
          href="/admin/advertisers"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> All advertisers
        </Link>

        {/* Top stats */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Monthly spend', value: formatCents(monthlySpend) },
            { label: 'Campaigns', value: formatNumber(campaigns.length) },
            {
              label: 'Active campaigns',
              value: formatNumber(campaigns.filter((c) => c.status === 'active').length),
            },
            { label: 'QR scans · 30d', value: formatNumber(totalScans) },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Phone {advertiser.phone ?? '—'} · Territory {territoryName(advertiser.territory_id)} ·
            Joined {formatDateTime(advertiser.created_at)}
          </p>
        </div>

        {/* Campaigns */}
        <div>
          <h2 className="mb-3 text-lg font-medium">Campaigns</h2>
          {campaigns.length === 0 ? (
            <Card>
              <CardContent className="p-5 text-sm text-muted-foreground">
                This advertiser hasn&apos;t created any campaigns yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {campaigns.map((c) => {
                const badge = statusBadge(c)
                const screens = screensByCampaign.get(c.id)?.size ?? 0
                const est = [...(venuesByCampaign.get(c.id)?.values() ?? [])].reduce(
                  (a, b) => a + b,
                  0
                )
                const scans = c.ad_id ? scansByAd.get(c.ad_id) ?? 0 : 0
                const sub = subByCampaign.get(c.id)
                return (
                  <Card key={c.id}>
                    <CardContent className="space-y-4 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex gap-4">
                          <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-black">
                            {c.ad?.creative_url ? (
                              c.ad.creative_type === 'video' ? (
                                <video src={c.ad.creative_url} className="h-full w-full object-contain" muted />
                              ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={c.ad.creative_url} alt={c.ad.title} className="h-full w-full object-contain" />
                              )
                            ) : (
                              <ImageOff className="size-5 text-muted-foreground" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium">{c.ad?.title ?? 'Untitled campaign'}</h3>
                              <Badge variant={badge.variant}>{badge.label}</Badge>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {c.package?.name ?? 'Custom'} ·{' '}
                              {formatCents(priceByCampaign.get(c.id) ?? 0)}/mo · {territoryName(c.territory_id)}
                            </p>
                            {c.ad?.status === 'rejected' && c.ad.rejection_reason && (
                              <p className="mt-1 text-sm text-destructive">
                                Rejected: {c.ad.rejection_reason}
                              </p>
                            )}
                            {sub && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Subscription {sub.status}
                                {sub.current_period_end
                                  ? ` · renews ${formatDateTime(sub.current_period_end)}`
                                  : ''}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-6 text-sm">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <TvIcon className="size-4" /> {screens} screen{screens === 1 ? '' : 's'}
                          </div>
                          <div className="text-right">
                            <p className="text-muted-foreground">Est. impr/mo</p>
                            <p className="font-medium tabular-nums">{formatNumber(est)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-muted-foreground">Goal</p>
                            <p className="font-medium tabular-nums">{formatNumber(c.target_impressions)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-muted-foreground">Scans 30d</p>
                            <p className="font-medium tabular-nums">{formatNumber(scans)}</p>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-border pt-4">
                        <CampaignAdminControls
                          campaignId={c.id}
                          status={c.status}
                          adId={c.ad_id}
                          adStatus={c.ad?.status ?? null}
                          goal={c.target_impressions}
                          screenCapOverride={c.screen_cap_override}
                        />
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

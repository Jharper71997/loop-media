import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ImageOff, ArrowLeft } from 'lucide-react'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatNumber, formatCents } from '@/lib/format'
import type { Ad, Campaign } from '@/lib/db.types'
import { CampaignControls } from './CampaignControls'

type CampaignFull = Campaign & {
  ad: Ad | null
  package: { name: string; base_price_cents: number } | null
}

export default async function CampaignDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ checkout?: string }>
}) {
  await requireProfile()
  const { id } = await params
  const { checkout } = await searchParams
  const supabase = await createClient()

  const { data } = await supabase
    .from('campaigns')
    .select('*, ad:ads(*), package:packages(name, base_price_cents)')
    .eq('id', id)
    .maybeSingle()
  if (!data) notFound()
  const c = data as unknown as CampaignFull

  const { data: placementsData } = await supabase
    .from('ad_placements')
    .select('id, tv:tvs(venue:venues(name, foot_traffic_estimate))')
    .eq('campaign_id', id)
    .neq('status', 'ended')
  type PRow = { id: string; tv: { venue: { name: string; foot_traffic_estimate: number } | null } | null }
  const placements = (placementsData ?? []) as unknown as PRow[]

  let qrScans = 0
  if (c.ad_id) {
    const { count } = await supabase
      .from('qr_scans')
      .select('id', { count: 'exact', head: true })
      .eq('ad_id', c.ad_id)
    qrScans = count ?? 0
  }

  const estImpressions = placements.reduce(
    (sum, p) => sum + (p.tv?.venue?.foot_traffic_estimate ?? 0),
    0
  )
  const locations = new Set(placements.map((p) => p.tv?.venue?.name).filter(Boolean)).size
  const progress = c.target_impressions
    ? Math.min(100, Math.round((estImpressions / c.target_impressions) * 100))
    : 0

  const adStatus = c.ad?.status
  const statusBadge =
    adStatus === 'rejected'
      ? { label: 'Rejected', cls: 'bg-destructive' }
      : adStatus === 'pending'
        ? { label: 'Pending review', cls: 'bg-amber-600' }
        : c.status === 'active'
          ? { label: 'Active', cls: 'bg-emerald-600' }
          : c.status === 'paused'
            ? { label: 'Paused', cls: 'bg-zinc-600' }
            : c.status === 'canceled'
              ? { label: 'Canceled', cls: 'bg-destructive' }
              : { label: 'Draft', cls: 'bg-zinc-600' }

  return (
    <div className="space-y-6">
      <Link
        href="/advertiser"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All campaigns
      </Link>

      {checkout === 'success' && (
        <div className="rounded-lg border border-emerald-600/40 bg-emerald-600/10 px-4 py-3 text-sm text-emerald-300">
          Payment received. Your ad is now pending review — we&apos;ll place it across screens once approved.
        </div>
      )}
      {checkout === 'canceled' && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Checkout canceled. Your campaign is saved as a draft — resume payment anytime.
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{c.ad?.title ?? 'Campaign'}</h1>
          <Badge className={statusBadge.cls}>{statusBadge.label}</Badge>
        </div>
        <CampaignControls id={c.id} status={c.status} />
      </div>

      {adStatus === 'rejected' && c.ad?.rejection_reason && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Rejected: {c.ad.rejection_reason}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        {/* Creative */}
        <Card className="overflow-hidden">
          <div className="flex aspect-video items-center justify-center bg-black">
            {c.ad?.creative_url ? (
              c.ad.creative_type === 'video' ? (
                <video src={c.ad.creative_url} className="h-full w-full object-contain" controls muted />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.ad.creative_url} alt={c.ad.title} className="h-full w-full object-contain" />
              )
            ) : (
              <div className="flex flex-col items-center gap-1 text-muted-foreground">
                <ImageOff className="size-6" />
                <span className="text-xs">Creative in production</span>
              </div>
            )}
          </div>
          <CardContent className="p-4 text-sm text-muted-foreground">
            {c.package?.name ?? 'Custom'} ·{' '}
            {c.package ? formatCents(c.package.base_price_cents) + '/mo' : 'flexible pricing'}
          </CardContent>
        </Card>

        {/* Analytics */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Estimated impressions / mo</p>
                  <p className="text-3xl font-semibold">{formatNumber(estImpressions)}</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  goal {formatNumber(c.target_impressions)}
                </p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Locations running</p>
                <p className="text-2xl font-semibold">{locations}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">QR scans</p>
                <p className="text-2xl font-semibold">{formatNumber(qrScans)}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-5">
              <p className="mb-2 text-sm font-medium">Screens</p>
              {placements.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {adStatus === 'approved' || c.status === 'active'
                    ? 'Placement runs shortly — we are matching your ad to the best screens.'
                    : 'Screens appear here once your ad is approved and the campaign is active.'}
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {placements.map((p) => (
                    <li key={p.id} className="flex justify-between">
                      <span>{p.tv?.venue?.name ?? 'Screen'}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {formatNumber(p.tv?.venue?.foot_traffic_estimate ?? 0)}/mo
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

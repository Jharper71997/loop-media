import Link from 'next/link'
import { ArrowLeft, ImageOff, Archive } from 'lucide-react'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { formatNumber, formatCents } from '@/lib/format'
import { type RunningVenue } from '@/lib/analytics'

// "Past campaigns" — archived campaigns the advertiser ended, with a recap of
// how each performed. Unlike the live detail page, this reconstructs the run
// from placements of ANY status (archived campaigns have ended placements) and
// counts QR scans over the campaign's whole life, not a 30-day window.
export default async function PastCampaignsPage() {
  const profile = await requireProfile()
  const supabase = await createClient()

  const { data: campData } = await supabase
    .from('campaigns')
    .select('id, ad_id, monthly_total_cents, created_at, archived_at, ad:ads(title, creative_type, creative_url)')
    .eq('advertiser_id', profile.id)
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false })

  type CampRow = {
    id: string
    ad_id: string | null
    monthly_total_cents: number | null
    created_at: string
    archived_at: string
    ad: { title: string; creative_type: 'video' | 'image'; creative_url: string | null } | null
  }
  const campaigns = (campData ?? []) as unknown as CampRow[]

  // Reconstruct where each campaign ran (placements of any status) + lifetime QR scans.
  const venuesByCampaign = new Map<string, RunningVenue[]>()
  const scansByCampaign = new Map<string, number>()
  if (campaigns.length) {
    const campIds = campaigns.map((c) => c.id)
    const adIds = campaigns.map((c) => c.ad_id).filter(Boolean) as string[]

    const { data: plData } = await supabase
      .from('ad_placements')
      .select('campaign_id, tv:tvs(id, venue:venues(id, name, lat, lng, foot_traffic_estimate))')
      .in('campaign_id', campIds)
    type PRow = {
      campaign_id: string | null
      tv: {
        id: string
        venue: { id: string; name: string; lat: number | null; lng: number | null; foot_traffic_estimate: number } | null
      } | null
    }
    for (const p of (plData ?? []) as unknown as PRow[]) {
      const v = p.tv?.venue
      const tvId = p.tv?.id
      if (!p.campaign_id || !v || !tvId) continue
      const list = venuesByCampaign.get(p.campaign_id) ?? []
      const existing = list.find((x) => x.venueId === v.id)
      if (existing) {
        if (!existing.tvIds.includes(tvId)) existing.tvIds.push(tvId)
      } else {
        list.push({
          venueId: v.id,
          name: v.name,
          lat: v.lat,
          lng: v.lng,
          footTraffic: v.foot_traffic_estimate ?? 0,
          tvIds: [tvId],
        })
      }
      venuesByCampaign.set(p.campaign_id, list)
    }

    if (adIds.length) {
      const { data: scanData } = await supabase
        .from('qr_scans')
        .select('ad_id')
        .in('ad_id', adIds)
      const byAd = new Map<string, number>()
      for (const s of (scanData ?? []) as { ad_id: string }[])
        byAd.set(s.ad_id, (byAd.get(s.ad_id) ?? 0) + 1)
      for (const c of campaigns) if (c.ad_id) scansByCampaign.set(c.id, byAd.get(c.ad_id) ?? 0)
    }
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="space-y-6">
      <Link
        href="/advertiser"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to campaigns
      </Link>

      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Past campaigns</h1>
        <p className="text-sm text-muted-foreground">
          Campaigns you&apos;ve ended, with how each one performed.
        </p>
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Archive className="size-7 text-muted-foreground" />
            <p className="max-w-xs text-sm text-muted-foreground">
              No past campaigns yet. When you archive a running campaign, it lands here with its
              performance recap.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {campaigns.map((c) => {
            const venues = venuesByCampaign.get(c.id) ?? []
            const screens = venues.reduce((s, v) => s + v.tvIds.length, 0)
            const scans = scansByCampaign.get(c.id) ?? 0
            return (
              <Link key={c.id} href={`/advertiser/campaigns/${c.id}`}>
                <Card className="overflow-hidden transition hover:border-primary/50">
                  <div className="flex flex-col gap-4 p-4 sm:flex-row">
                    <div className="flex aspect-video w-full shrink-0 items-center justify-center rounded-lg bg-black sm:w-44">
                      {c.ad?.creative_url ? (
                        c.ad.creative_type === 'video' ? (
                          <video src={c.ad.creative_url} className="h-full w-full rounded-lg object-contain" muted />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.ad.creative_url} alt={c.ad.title} className="h-full w-full rounded-lg object-contain" />
                        )
                      ) : (
                        <ImageOff className="size-6 text-muted-foreground" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{c.ad?.title ?? 'Untitled campaign'}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {fmtDate(c.created_at)} – {fmtDate(c.archived_at)}
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-3">
                        <Stat label="Screens" value={formatNumber(screens)} />
                        <Stat label="QR scans (total)" value={formatNumber(scans)} />
                        <Stat
                          label="Monthly cost"
                          value={c.monthly_total_cents != null ? formatCents(c.monthly_total_cents) : '—'}
                        />
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

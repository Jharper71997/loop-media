import { AlertTriangle } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, SCREEN_TABS } from '@/components/admin/SectionTabs'
import { AutoRefresh } from '@/components/app/AutoRefresh'
import { summarizeUptime, venueBusinessHours, screenDownState } from '@/lib/uptime'
import { loadBillingRows } from '@/lib/adminInbox'
import { ScreenTable, type ScreenRow } from './ScreenTable'

export const dynamic = 'force-dynamic'

type VenueRow = {
  id: string
  name: string
  business_open: string | null
  business_close: string | null
  business_days: number[] | null
  business_hours: Record<string, { open: string; close: string }> | null
  tvs: { id: string; device_id: string | null; last_heartbeat_at: string | null }[]
}

export default async function UptimePage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()
  const billing = await loadBillingRows(t)

  let venueQ = supabase
    .from('venues')
    .select(
      'id, name, business_open, business_close, business_days, business_hours, tvs(id, device_id, last_heartbeat_at)'
    )
    .order('name')
  if (t) venueQ = venueQ.eq('territory_id', t)
  const { data: venueData } = await venueQ
  const venues = (venueData ?? []) as unknown as VenueRow[]

  const allTvIds = venues.flatMap((v) => v.tvs.map((tv) => tv.id))

  // Pull the last 30 days of per-screen uptime seconds in one query.
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 30)
  const sinceDay = since.toISOString().slice(0, 10)
  const uptimeByTv = new Map<string, { day: string; seconds: number }[]>()
  if (allTvIds.length) {
    const { data: up } = await supabase
      .from('tv_uptime_days')
      .select('tv_id, day, seconds')
      .in('tv_id', allTvIds)
      .gte('day', sinceDay)
    for (const r of (up ?? []) as { tv_id: string; day: string; seconds: number }[]) {
      const list = uptimeByTv.get(r.tv_id) ?? []
      list.push({ day: r.day, seconds: r.seconds })
      uptimeByTv.set(r.tv_id, list)
    }
  }

  // One row per paired screen, worst uptime first; unpaired screens excluded.
  // What each screen is carrying: the monthly value of the campaigns placed on
  // it, split across the screens each campaign runs on. A screen going dark is a
  // different size of problem depending on who is on it, and the uptime page
  // could never say which.
  const atRiskByTv = new Map<string, number>()
  const adsByTv = new Map<string, number>()
  {
    const { data: places } = await supabase
      .from('ad_placements')
      .select('campaign_id, tv_id')
      .eq('status', 'active')
    const tvsByCampaign = new Map<string, string[]>()
    for (const p of (places ?? []) as { campaign_id: string | null; tv_id: string }[]) {
      adsByTv.set(p.tv_id, (adsByTv.get(p.tv_id) ?? 0) + 1)
      if (!p.campaign_id) continue
      tvsByCampaign.set(p.campaign_id, [...(tvsByCampaign.get(p.campaign_id) ?? []), p.tv_id])
    }
    const monthlyByCampaign = new Map(billing.map((b) => [b.campaignId, b.monthlyCents]))
    for (const [campaignId, ids] of tvsByCampaign) {
      const monthly = monthlyByCampaign.get(campaignId) ?? 0
      if (!monthly || !ids.length) continue
      const share = Math.round(monthly / ids.length)
      for (const tvId of ids) atRiskByTv.set(tvId, (atRiskByTv.get(tvId) ?? 0) + share)
    }
  }

  const rows: ScreenRow[] = []
  for (const v of venues) {
    const bh = venueBusinessHours(v)
    for (const tv of v.tvs) {
      if (!tv.device_id) continue // not paired yet, nothing to measure
      const summary = summarizeUptime(uptimeByTv.get(tv.id) ?? [], bh)
      rows.push({
        tvId: tv.id,
        venueId: v.id,
        venueName: v.name,
        pct: summary.pct,
        breach: summary.breach,
        hasData: summary.hasData,
        // The honest "is it broken" rule: quiet during open hours, or quiet over
        // a day. isTvLive's 95 seconds calls every closed venue an outage.
        down: screenDownState(tv.last_heartbeat_at, v).down,
        lastHeartbeat: tv.last_heartbeat_at,
        atRiskCents: atRiskByTv.get(tv.id) ?? 0,
        adsHere: adsByTv.get(tv.id) ?? 0,
      })
    }
  }

  const breaches = rows.filter((r) => r.breach).length
  const downNow = rows.filter((r) => r.down).length

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader
        title="Uptime"
        description={`${rows.length} paired screen${rows.length === 1 ? '' : 's'} · ${breaches} below SLA · ${downNow} down now`}
      />
      <SectionTabs tabs={SCREEN_TABS} />

      <div className="space-y-3 p-3 md:p-4">
        {breaches > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              {breaches} screen{breaches === 1 ? '' : 's'} ran below the 80% business-hours SLA over
              the last 30 days. Call the host, and rotate affected advertisers if a location stays
              dark.
            </span>
          </div>
        )}

        <ScreenTable rows={rows} />

        <p className="text-xs text-muted-foreground">
          Uptime is measured on-time during each venue&apos;s set business hours over the last 30
          days. The guarantee is 80% of business hours, not 24/7.
        </p>
      </div>
    </>
  )
}

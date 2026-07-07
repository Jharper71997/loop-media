import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { placeCampaign } from '@/lib/placement'

// Nightly recompute: re-run the placement engine for every active campaign.
// Placement is target-driven — an ad only fills the screens the advertiser
// picked (campaign_targets) — so this just backfills newly-available slots at
// those picked venues (e.g. a screen added to a venue they already chose). It
// never sprays to un-picked screens and respects admin overrides
// (placement_exclusions). Protected by CRON_SECRET (Vercel sends it as Bearer).
// Manual run: curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/place
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: campaigns } = await admin
    .from('campaigns')
    .select('id')
    .eq('status', 'active')

  // Accumulate this month's placement snapshot as we go. Upsert-ignore means a
  // screen active on ANY day this month is recorded once, so the monthly report can
  // attribute scans to screens the ad ran on even if they're paused by report time.
  const month = new Date().toISOString().slice(0, 7)

  const results = []
  for (const c of campaigns ?? []) {
    const r = await placeCampaign(c.id, admin)
    results.push({ campaign: c.id, ok: r.ok, created: r.created, screens: r.screens, reason: r.reason })

    const { data: activePl } = await admin
      .from('ad_placements')
      .select('tv_id, tv:tvs(venue_id)')
      .eq('campaign_id', c.id)
      .eq('status', 'active')
    const snapRows = ((activePl ?? []) as unknown as {
      tv_id: string
      tv: { venue_id: string | null } | null
    }[])
      .filter((p) => p.tv_id)
      .map((p) => ({
        campaign_id: c.id,
        tv_id: p.tv_id,
        venue_id: p.tv?.venue_id ?? null,
        period_month: month,
      }))
    if (snapRows.length) {
      await admin
        .from('placement_snapshots')
        .upsert(snapRows, { onConflict: 'campaign_id,tv_id,period_month', ignoreDuplicates: true })
    }
  }

  return NextResponse.json({ ran: results.length, results })
}

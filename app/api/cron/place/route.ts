import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { placeCampaign } from '@/lib/placement'
import { applyDueScheduledCreatives } from '@/lib/scheduledCreatives'

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

  // Expire finished "free week" comps FIRST: pause any active campaign past its
  // comp_until so a comped ad comes off screens on its own, and clear the timer.
  // Defensive: if the comp_until column isn't present yet (migration not applied),
  // skip silently rather than break the whole placement run.
  let compsExpired = 0
  try {
    const nowIso = new Date().toISOString()
    const { data: expired } = await admin
      .from('campaigns')
      .select('id, ad_id')
      .eq('status', 'active')
      .not('comp_until', 'is', null)
      .lt('comp_until', nowIso)
    for (const c of (expired ?? []) as { id: string; ad_id: string | null }[]) {
      await admin.from('campaigns').update({ status: 'paused', comp_until: null }).eq('id', c.id)
      if (c.ad_id) await admin.from('ads').update({ status: 'paused' }).eq('id', c.ad_id)
      await admin
        .from('ad_placements')
        .update({ status: 'paused' })
        .eq('campaign_id', c.id)
        .eq('status', 'active')
      compsExpired++
    }
  } catch {
    /* comp_until column not present yet — nothing to expire */
  }

  // Content calendar: push any creative whose scheduled date has arrived. Runs
  // BEFORE placement so a swapped ad is the one placement sees tonight. Each
  // scheduled swap still goes to admin review like a manual one — submitting a
  // day early (SCHEDULE_LEAD_DAYS) is what gets it approved and airing on the
  // advertiser's actual date.
  const scheduled = await applyDueScheduledCreatives(admin)

  const { data: campaigns } = await admin
    .from('campaigns')
    .select('id')
    .eq('status', 'active')
    // Demo campaigns are never placed on a real screen.
    .eq('is_demo', false)

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

  return NextResponse.json({ ran: results.length, compsExpired, scheduled, results })
}

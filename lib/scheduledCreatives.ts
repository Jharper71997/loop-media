// Content calendar: turn a due scheduled_creatives row into a real creative swap.
//
// Called nightly from /api/cron/place. The rules it has to respect are the same
// ones a manual swap respects, so it deliberately routes through the SAME
// pipeline (ad_change_requests + applyAdChange) instead of writing to `ads`
// directly:
//   * every swap goes back to admin review — the calendar changes WHEN a swap is
//     submitted, never WHETHER it's reviewed;
//   * the campaign's weekly free change is honored. If it's already used, the row
//     waits (and says so) rather than charging $10 unattended in the middle of
//     the night. Members are always free, so their calendar never waits.
//
// Server-only (service-role admin client).

import { createAdminClient } from '@/lib/supabase/admin'
import { applyAdChange } from '@/lib/adChanges'
import { hasUnlimitedChanges } from '@/lib/membership'
import { AD_CHANGE_FREE_EVERY_DAYS } from '@/lib/fees'

type Admin = ReturnType<typeof createAdminClient>

// Submit a scheduled spot one day early so it clears review overnight and is
// actually ON SCREEN on the advertiser's date, not queued that morning.
export const SCHEDULE_LEAD_DAYS = 1

// A row that still can't land this long after its date has been waiting on a
// free change for weeks (or the campaign went quiet). Give up rather than
// surprising someone with a stale spot months later.
export const SCHEDULED_STALE_DAYS = 21

const DAY_MS = 24 * 60 * 60 * 1000

// Campaign states where pushing a new creative makes no sense. A paused campaign
// still gets its swap — the advertiser may be prepping to resume.
const DEAD_CAMPAIGN_STATUSES = ['canceled', 'trashed', 'archived']

export type ScheduledRunResult = {
  applied: number
  waiting: number
  skipped: number
}

// Date-only helper: 'YYYY-MM-DD' for `now` shifted by `days`. run_on is a DATE
// column, so all comparisons are string comparisons on that format.
export function isoDay(now: Date, days = 0): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString().slice(0, 10)
}

// True if this campaign has already used its one free change in the rolling
// window. Mirrors the check in replaceCreative so the calendar and the manual
// button can't disagree about whether a change is free.
async function usedFreeChange(admin: Admin, campaignId: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - AD_CHANGE_FREE_EVERY_DAYS * DAY_MS).toISOString()
  const { count } = await admin
    .from('ad_change_requests')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'applied')
    .gte('applied_at', since)
  return (count ?? 0) > 0
}

// Apply every scheduled creative that is due (run_on <= today + lead time).
// Rows are processed oldest-date-first so a campaign with two near dates lands
// them in the order the advertiser planned. Never throws — the caller is a cron
// route that must finish its other work regardless.
export async function applyDueScheduledCreatives(
  admin: Admin,
  now: Date = new Date()
): Promise<ScheduledRunResult> {
  const out: ScheduledRunResult = { applied: 0, waiting: 0, skipped: 0 }

  let due: DueRow[] = []
  try {
    const { data } = await admin
      .from('scheduled_creatives')
      .select('id, campaign_id, advertiser_id, creative_url, creative_type, run_on, label')
      .eq('status', 'scheduled')
      .lte('run_on', isoDay(now, SCHEDULE_LEAD_DAYS))
      .order('run_on', { ascending: true })
    due = (data ?? []) as DueRow[]
  } catch {
    // Table not present yet (migration 0063 not applied) — nothing to do.
    return out
  }
  if (!due.length) return out

  const staleBefore = isoDay(now, -SCHEDULED_STALE_DAYS)
  // One membership lookup per advertiser, not per row — a year-long calendar can
  // come due in bulk after an outage.
  const memberCache = new Map<string, boolean>()
  // A campaign that lands a swap in this run has just burned its free change, so
  // later rows for the same campaign must wait for the next window.
  const burnedFree = new Set<string>()

  for (const row of due) {
    try {
      const { data: campaign } = await admin
        .from('campaigns')
        .select('id, ad_id, status, advertiser_id')
        .eq('id', row.campaign_id)
        .maybeSingle()

      if (!campaign || campaign.advertiser_id !== row.advertiser_id) {
        await skip(admin, row.id, 'That campaign is no longer available.')
        out.skipped++
        continue
      }
      if (DEAD_CAMPAIGN_STATUSES.includes(campaign.status as string)) {
        await skip(admin, row.id, `Campaign was ${campaign.status} before this date arrived.`)
        out.skipped++
        continue
      }
      if (!campaign.ad_id) {
        await skip(admin, row.id, 'That campaign has no ad to swap yet.')
        out.skipped++
        continue
      }

      if (!memberCache.has(row.advertiser_id)) {
        memberCache.set(row.advertiser_id, await hasUnlimitedChanges(admin, row.advertiser_id))
      }
      const isMember = memberCache.get(row.advertiser_id) === true
      const noStripe = !process.env.STRIPE_SECRET_KEY
      const free =
        isMember ||
        noStripe ||
        (!burnedFree.has(row.campaign_id) && !(await usedFreeChange(admin, row.campaign_id, now)))

      if (!free) {
        if (row.run_on < staleBefore) {
          await skip(
            admin,
            row.id,
            'Never ran — the campaign used its free change every week this spot waited.'
          )
          out.skipped++
          continue
        }
        await admin
          .from('scheduled_creatives')
          .update({
            status_note:
              'Waiting for this campaign’s next free weekly change — it goes up as soon as the window opens.',
          })
          .eq('id', row.id)
        out.waiting++
        continue
      }

      const { data: change } = await admin
        .from('ad_change_requests')
        .insert({
          campaign_id: row.campaign_id,
          ad_id: campaign.ad_id,
          advertiser_id: row.advertiser_id,
          creative_url: row.creative_url,
          creative_type: row.creative_type,
          fee_cents: 0,
          status: 'waived',
        })
        .select('id')
        .single()
      if (!change) {
        out.waiting++
        continue
      }

      const res = await applyAdChange(admin, change.id)
      if (!res.ok) {
        out.waiting++
        continue
      }

      burnedFree.add(row.campaign_id)
      await admin
        .from('scheduled_creatives')
        .update({
          status: 'applied',
          applied_at: new Date().toISOString(),
          ad_change_id: change.id,
          status_note: null,
        })
        .eq('id', row.id)
      out.applied++
    } catch {
      // One bad row must not stop the rest of the calendar.
      out.waiting++
    }
  }

  return out
}

type DueRow = {
  id: string
  campaign_id: string
  advertiser_id: string
  creative_url: string
  creative_type: 'image' | 'video'
  run_on: string
  label: string | null
}

async function skip(admin: Admin, id: string, note: string) {
  await admin.from('scheduled_creatives').update({ status: 'skipped', status_note: note }).eq('id', id)
}

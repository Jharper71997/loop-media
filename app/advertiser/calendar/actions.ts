'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProfile } from '@/lib/auth'
import { isOwnCreativeUrl } from '@/lib/adCreative'
import { MAX_SCHEDULE_DAYS, isoDayLocal } from '@/lib/calendar'

// Every write here is service-role (scheduled_creatives is read-only under the
// advertiser's RLS), so ownership is checked in code first — same shape as the
// campaign actions.
async function ownCampaign(id: string) {
  const profile = await requireProfile()
  const supabase = await createClient()
  const { data } = await supabase
    .from('campaigns')
    .select('id, advertiser_id, ad_id, status')
    .eq('id', id)
    .maybeSingle()
  if (!data || data.advertiser_id !== profile.id) return null
  return data as { id: string; advertiser_id: string; ad_id: string | null; status: string }
}

function revalidate() {
  revalidatePath('/advertiser/calendar')
  revalidatePath('/host/advertise/calendar')
}

// Earliest schedulable date is tomorrow: the nightly cron has already run for
// today, and a spot needs one overnight in review before it airs.
function dateWindow(): { min: string; max: string } {
  const now = new Date()
  return { min: isoDayLocal(now, 1), max: isoDayLocal(now, MAX_SCHEDULE_DAYS) }
}

export async function scheduleCreative(input: {
  campaignId: string
  creativeUrl: string
  creativeType: 'image' | 'video'
  runOn: string
  label: string
}): Promise<{ error?: string; id?: string }> {
  const { campaignId, creativeUrl, creativeType, runOn } = input
  const label = input.label.trim().slice(0, 80)

  if (!creativeUrl) return { error: 'No creative was uploaded.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runOn)) return { error: 'Pick a date for this spot.' }

  const { min, max } = dateWindow()
  if (runOn < min) return { error: 'Pick a date from tomorrow onward.' }
  if (runOn > max) return { error: 'You can plan about a year ahead.' }

  const c = await ownCampaign(campaignId)
  if (!c) return { error: 'Campaign not found.' }
  if (!c.ad_id) return { error: 'This campaign has no ad to swap yet.' }
  if (['canceled', 'trashed', 'archived'].includes(c.status)) {
    return { error: 'That campaign is no longer running.' }
  }

  const profile = await requireProfile()
  // Same rule as a manual swap: the file must live in this advertiser's own
  // storage folder, never an external URL, so the creative that eventually goes
  // to review can't be swapped out from under it.
  if (!isOwnCreativeUrl(creativeUrl, profile.id)) {
    return { error: 'We could not verify that creative. Upload your file again.' }
  }

  const admin = createAdminClient()
  const { data: clash } = await admin
    .from('scheduled_creatives')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('run_on', runOn)
    .eq('status', 'scheduled')
    .maybeSingle()
  if (clash) return { error: 'You already have a spot scheduled for that date on this campaign.' }

  const { data, error } = await admin
    .from('scheduled_creatives')
    .insert({
      campaign_id: campaignId,
      advertiser_id: profile.id,
      label,
      creative_url: creativeUrl,
      creative_type: creativeType,
      run_on: runOn,
    })
    .select('id')
    .single()
  if (error || !data) return { error: 'Could not save that to your calendar. Try again.' }

  revalidate()
  return { id: data.id }
}

// Own a scheduled row (via its campaign) and return it.
async function ownScheduled(id: string) {
  const profile = await requireProfile()
  const admin = createAdminClient()
  const { data } = await admin
    .from('scheduled_creatives')
    .select('id, advertiser_id, campaign_id, status')
    .eq('id', id)
    .maybeSingle()
  if (!data || data.advertiser_id !== profile.id) return null
  return data as { id: string; advertiser_id: string; campaign_id: string; status: string }
}

export async function cancelScheduled(id: string): Promise<{ error?: string }> {
  const row = await ownScheduled(id)
  if (!row) return { error: 'That scheduled spot was not found.' }
  if (row.status === 'applied') {
    return { error: 'That spot has already gone up. Replace the creative on the campaign instead.' }
  }
  const admin = createAdminClient()
  await admin
    .from('scheduled_creatives')
    .update({ status: 'canceled', status_note: null })
    .eq('id', id)
  revalidate()
  return {}
}

// Drag/pick a different date for a spot that hasn't gone up yet.
export async function rescheduleCreative(id: string, runOn: string): Promise<{ error?: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runOn)) return { error: 'Pick a valid date.' }
  const { min, max } = dateWindow()
  if (runOn < min) return { error: 'Pick a date from tomorrow onward.' }
  if (runOn > max) return { error: 'You can plan about a year ahead.' }

  const row = await ownScheduled(id)
  if (!row) return { error: 'That scheduled spot was not found.' }
  if (row.status !== 'scheduled') return { error: 'Only upcoming spots can be moved.' }

  const admin = createAdminClient()
  const { data: clash } = await admin
    .from('scheduled_creatives')
    .select('id')
    .eq('campaign_id', row.campaign_id)
    .eq('run_on', runOn)
    .eq('status', 'scheduled')
    .neq('id', id)
    .maybeSingle()
  if (clash) return { error: 'You already have a spot scheduled for that date on this campaign.' }

  const { error } = await admin
    .from('scheduled_creatives')
    .update({ run_on: runOn, status_note: null })
    .eq('id', id)
  if (error) return { error: 'Could not move that spot. Try again.' }
  revalidate()
  return {}
}

'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth'
import { activatePlacementsIfReady, placeCampaign } from '@/lib/placement'
import type { CampaignStatus } from '@/lib/db.types'

function ok() {
  revalidatePath('/admin/advertisers', 'layout')
  return { error: null as string | null }
}

// ---- ad review (mirrors admin/queue/actions.ts) ----
export async function approveAd(id: string) {
  const profile = await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from('ads')
    .update({
      status: 'approved',
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: null,
    })
    .eq('id', id)
  if (error) return { error: error.message }

  const admin = createAdminClient()
  const { data: campaigns } = await admin.from('campaigns').select('id').eq('ad_id', id)
  for (const c of campaigns ?? []) await activatePlacementsIfReady(c.id, admin)
  return ok()
}

export async function rejectAd(id: string, reason: string) {
  const profile = await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from('ads')
    .update({
      status: 'rejected',
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason || 'Not specified',
    })
    .eq('id', id)
  if (error) return { error: error.message }
  return ok()
}

// ---- campaign status overrides ----
async function setCampaignStatus(id: string, status: CampaignStatus) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase.from('campaigns').update({ status }).eq('id', id)
  if (error) return { error: error.message }
  if (status === 'active') await activatePlacementsIfReady(id)
  return ok()
}
export async function pauseCampaign(id: string) {
  return setCampaignStatus(id, 'paused')
}
export async function resumeCampaign(id: string) {
  return setCampaignStatus(id, 'active')
}
export async function cancelCampaign(id: string) {
  return setCampaignStatus(id, 'canceled')
}

// ---- campaign tuning ----
export async function setCampaignGoal(id: string, value: number | null) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from('campaigns')
    .update({ target_impressions: value ?? 0 })
    .eq('id', id)
  if (error) return { error: error.message }
  return ok()
}

export async function setCampaignScreenCap(id: string, value: number | null) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from('campaigns')
    .update({ screen_cap_override: value })
    .eq('id', id)
  if (error) return { error: error.message }
  return ok()
}

// Manually re-run the placement engine for one campaign (fills toward goal/cap).
export async function rerunPlacement(id: string) {
  await requireAdmin()
  const res = await placeCampaign(id)
  revalidatePath('/admin/advertisers', 'layout')
  if (!res.ok) return { error: res.reason ?? 'Placement failed.' }
  return { error: null as string | null, created: res.created, screens: res.screens }
}

// ---- advertiser profile ----
export async function updateAdvertiserProfile(
  id: string,
  input: { full_name: string; phone: string; territory_id: string | null }
) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: input.full_name.trim() || null,
      phone: input.phone.trim() || null,
      territory_id: input.territory_id,
    })
    .eq('id', id)
  if (error) return { error: error.message }
  return ok()
}

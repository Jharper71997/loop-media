// Membership helpers. Today there's one membership kind, 'unlimited_changes',
// which makes creative changes free for the advertiser who holds it. Server-only
// (uses the service-role admin client; callers pass it in to share a connection).

import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// True if the advertiser has an active unlimited-changes membership. "Active"
// means status 'active' and, if a period end is recorded, that it hasn't lapsed
// (a small grace is intentionally NOT given — the webhook keeps status fresh).
export async function hasUnlimitedChanges(
  admin: Admin,
  advertiserId: string
): Promise<boolean> {
  const { data } = await admin
    .from('memberships')
    .select('status, current_period_end')
    .eq('advertiser_id', advertiserId)
    .eq('kind', 'unlimited_changes')
    .eq('status', 'active')
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return false
  if (data.current_period_end && new Date(data.current_period_end).getTime() < Date.now()) {
    return false
  }
  return true
}

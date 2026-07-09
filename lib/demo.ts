// Guided sales demo — server-only helpers.
//
// The /demo/host and /demo/advertiser walkthroughs let a prospect (or Jacob
// screen-sharing) experience the ACTUAL sign-up → set-up → dashboard → map flow
// without touching the live network. Each run provisions a throwaway account
// flagged profiles.is_demo; everything it creates inherits is_demo and is hidden
// from real users, admins, revenue, and the TVs (see migration 0053). Nothing is
// charged and no ad ever reaches a real screen.
//
// Never import this into client code — it uses the service-role admin client.
// Pure sample data (form prefills) lives in lib/demoData.ts so client components
// can share it without pulling in the admin client.
import { createAdminClient } from '@/lib/supabase/admin'
import { DEMO_EMAIL_DOMAIN, DEMO_HOST, DEMO_ADVERTISER } from '@/lib/demoData'

export { DEMO_EMAIL_DOMAIN, DEMO_COMP_CODE, DEMO_HOST, DEMO_ADVERTISER } from '@/lib/demoData'

function token(n = 10): string {
  return Math.random().toString(36).slice(2, 2 + n)
}

export interface DemoUser {
  email: string
  password: string
  userId: string
}

// Create a throwaway demo account and return sign-in credentials. Uses the
// service role so email confirmation is bypassed regardless of the project's Auth
// setting — the demo must land in the app immediately. The generated email is
// unique and non-routable, so it can never collide with a real prospect's signup.
export async function provisionDemoUser(opts: {
  role: 'host' | 'advertiser'
  fullName?: string | null
  categoryId?: string | null
}): Promise<DemoUser | { error: string }> {
  const admin = createAdminClient()
  const email = `demo-${opts.role}-${token()}${Date.now().toString(36)}@${DEMO_EMAIL_DOMAIN}`
  const password = `Demo!${token(16)}`
  const full_name =
    opts.fullName?.trim() ||
    (opts.role === 'host' ? DEMO_HOST.fullName : DEMO_ADVERTISER.fullName)

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role: opts.role },
  })
  if (error || !data.user) return { error: error?.message ?? 'Could not start the demo.' }
  const userId = data.user.id

  // The on_auth_user_created trigger inserts the profile (role clamped to
  // host/advertiser). Upsert to flag it demo — and lock in the advertiser's sample
  // category so the buy flow never re-asks. Upsert (not update) guards the rare
  // case where the trigger hasn't materialized the row yet.
  await admin.from('profiles').upsert(
    {
      id: userId,
      email,
      full_name,
      role: opts.role,
      is_demo: true,
      ...(opts.role === 'advertiser' && opts.categoryId ? { category_id: opts.categoryId } : {}),
    },
    { onConflict: 'id' }
  )

  return { email, password, userId }
}

async function safe(p: PromiseLike<unknown>): Promise<void> {
  try {
    await p
  } catch {
    /* housekeeping — never throw */
  }
}

// Delete demo accounts (and everything they created) older than `maxAgeHours`.
// Called best-effort when a new demo starts, so demo data never accumulates.
// Pass 0 to purge ALL demo data (the admin "Reset demo" button).
export async function cleanupStaleDemo(maxAgeHours = 6): Promise<{ removed: number }> {
  const admin = createAdminClient()
  const cutoff = new Date(Date.now() - maxAgeHours * 3_600_000).toISOString()
  const { data: stale } = await admin
    .from('profiles')
    .select('id')
    .eq('is_demo', true)
    .lt('created_at', cutoff)
    .limit(100)
  const ids = (stale ?? []).map((p) => p.id as string)
  if (!ids.length) return { removed: 0 }

  const { data: dv } = await admin.from('venues').select('id').eq('is_demo', true).in('host_user_id', ids)
  const venueIds = (dv ?? []).map((v) => v.id as string)
  const { data: dc } = await admin.from('campaigns').select('id').eq('is_demo', true).in('advertiser_id', ids)
  const campIds = (dc ?? []).map((c) => c.id as string)

  if (campIds.length) {
    await safe(admin.from('campaign_targets').delete().in('campaign_id', campIds))
    await safe(admin.from('exclusive_slots').delete().in('campaign_id', campIds))
    await safe(admin.from('ad_placements').delete().in('campaign_id', campIds))
  }
  await safe(admin.from('subscriptions').delete().in('advertiser_id', ids))
  await safe(admin.from('campaigns').delete().eq('is_demo', true).in('advertiser_id', ids))
  await safe(admin.from('ads').delete().eq('is_demo', true).in('owner_user_id', ids))
  if (venueIds.length) {
    await safe(admin.from('venue_provisioning').delete().in('venue_id', venueIds))
    await safe(admin.from('tvs').delete().in('venue_id', venueIds))
  }
  await safe(admin.from('venues').delete().eq('is_demo', true).in('host_user_id', ids))
  for (const id of ids) await safe(admin.auth.admin.deleteUser(id))

  return { removed: ids.length }
}

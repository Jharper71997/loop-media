'use server'

import { createClient } from '@/lib/supabase/server'

// Mark the current host as having finished (or skipped) the first-run walkthrough
// so it never auto-starts again, on any device. Best-effort and idempotent: the
// tour calls it on finish/skip without blocking on the result. RLS lets a user
// update their own profiles row (profiles_update_self), so the session client is
// enough — no service role needed.
export async function completeHostTour(): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('profiles').update({ onboarding_host_done: true }).eq('id', user.id)
}

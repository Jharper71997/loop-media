import { createClient } from '@supabase/supabase-js'

// Service-role client — BYPASSES RLS. Server-only. Use for the TV display loop
// API, the placement engine, the Stripe webhook and the QR redirect, which act
// outside any signed-in user's permissions. Never import this into client code.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

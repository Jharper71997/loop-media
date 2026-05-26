import { createBrowserClient } from '@supabase/ssr'

// Browser/client-component Supabase client. Reads the public anon key; all
// access is constrained by RLS policies (see supabase/migrations/0002_rls.sql).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

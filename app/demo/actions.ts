'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { provisionDemoUser, cleanupStaleDemo } from '@/lib/demo'

// Start a guided demo: sweep stale demo data, mint a throwaway account, sign in
// (server-side, so it works whether or not email confirmation is on), then drop
// the visitor at the first real step of the flow. Called from the demo sign-up
// form. On success it REDIRECTS (never returns); only errors come back.
export async function beginDemo(input: {
  role: 'host' | 'advertiser'
  fullName?: string | null
  categoryId?: string | null
}): Promise<{ error: string }> {
  await cleanupStaleDemo().catch(() => {})

  const provisioned = await provisionDemoUser(input)
  if ('error' in provisioned) return { error: provisioned.error }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: provisioned.email,
    password: provisioned.password,
  })
  if (error) return { error: error.message }

  // Host: straight into venue registration (they now pass the host gate).
  // Advertiser: straight to the map — the payoff — with the category already set.
  redirect(input.role === 'host' ? '/host/register' : '/advertiser/browse')
}

// Leave the demo: end the throwaway session and return to the login screen.
export async function exitDemo(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

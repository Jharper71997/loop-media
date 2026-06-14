import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { homeForRole } from '@/lib/auth'

// Exchanges a Supabase auth code for a session, then redirects. Used by:
//  - password-recovery emails (resetPasswordForEmail redirectTo here, next=/update-password)
//  - email-confirmation links, if email confirmation is left on
// Without this route those links dead-end and never establish a session.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next')

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      if (next) return NextResponse.redirect(new URL(next, url.origin))
      // No explicit target → send them to their role's home.
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single()
        return NextResponse.redirect(new URL(homeForRole(profile?.role ?? 'advertiser'), url.origin))
      }
    }
  }

  // Bad/expired code → back to login with a hint.
  return NextResponse.redirect(new URL('/login?error=auth_link', url.origin))
}

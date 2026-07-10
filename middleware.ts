import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Authenticated-area prefixes. Role-level gating (admin vs advertiser vs host)
// happens in each area's layout/server component where the profile is queried;
// middleware just refreshes the session and bounces anonymous users to /login.
const PROTECTED_PREFIXES = ['/admin', '/advertiser', '/host', '/dashboard']

function isProtected(pathname: string) {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  )
}

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  // Middleware runs on EVERY route. If the Supabase env is missing/typo'd in
  // prod, createServerClient throws → MIDDLEWARE_INVOCATION_FAILED → the WHOLE
  // site 500s, even public pages. Fail open (skip auth refresh) instead so the
  // outage is contained to login, not the marketing site.
  if (!supabaseUrl || !supabaseAnonKey) {
    return res
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
          res = NextResponse.next({ request: req })
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: getUser() refreshes the auth token and writes cookies via setAll.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && isProtected(req.nextUrl.pathname)) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', req.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  return res
}

export const config = {
  // Run ONLY on the authenticated app areas (same prefixes as isProtected above).
  // Everything else — /tv and every /api/tv/* + /api/trivia/* poll, /play, the
  // marketing pages, /login — no longer pays a Supabase getUser() round-trip on
  // each hit. Each always-on TV polls those routes thousands of times a day, so
  // running auth middleware there was the main driver of Edge Middleware
  // invocations + Fluid CPU. Protected pages still refresh the session and bounce
  // anonymous users; server actions post to these same page paths, so they stay
  // covered. Unauthenticated device/cron/webhook routes don't need it.
  matcher: [
    '/admin/:path*',
    '/advertiser/:path*',
    '/host/:path*',
    '/dashboard/:path*',
  ],
}

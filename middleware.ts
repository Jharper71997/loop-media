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
  matcher: [
    // Run on everything except static assets and image files.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}

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

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

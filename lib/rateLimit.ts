import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Fixed-window rate limit backed by Postgres (the check_rate_limit RPC, migration
 * 0034). Returns true if the request is ALLOWED, false if it exceeded `max` in the
 * window.
 *
 * Fails OPEN: any limiter error resolves to `true`. For this product availability
 * beats throttling — a limiter bug must never be able to dark the screen network.
 *
 *   const ok = await rateLimit('tv_pair', clientIp(req), 5, 60)
 *   if (!ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
 */
export async function rateLimit(
  bucket: string,
  key: string,
  max: number,
  windowSecs: number
): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('check_rate_limit', {
      p_bucket: bucket,
      p_key: key,
      p_max: max,
      p_window_secs: windowSecs,
    })
    if (error) return true // fail open
    return data !== false
  } catch {
    return true // fail open
  }
}

/** Best-effort client IP from proxy headers (mirrors app/r/[code]/route.ts). */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

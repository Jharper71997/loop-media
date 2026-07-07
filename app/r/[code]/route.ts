import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { isBot } from '@/lib/bots'

// A repeat scan from the same phone on the same ad inside this window counts once.
const DEDUP_WINDOW_MS = 30 * 60 * 1000

// QR redirect + scan logger. The QR on a screen encodes /r/<ad_id>?t=<tv_id>;
// scanning it logs a qr_scans row (hashed IP, never raw) and 302s to the ad's
// destination. Runs with the service role (qr_scans is admin-write).
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function hashIp(ip: string | null): string | null {
  if (!ip) return null
  // Dedicated salt; never fall back to a public constant (that made the hashes
  // trivially reversible) and don't reuse CRON_SECRET for two unrelated jobs.
  // If no salt is configured, don't store a weakly-hashed IP at all.
  const salt = process.env.IP_HASH_SALT
  if (!salt) return null
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32)
}

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params
  const url = new URL(req.url)
  const home = new URL('/', url.origin)

  if (!UUID.test(code)) return NextResponse.redirect(home, 302)

  const supabase = createAdminClient()
  const { data: ad } = await supabase
    .from('ads')
    .select('id, qr_target_url')
    .eq('id', code)
    .maybeSingle()
  if (!ad) return NextResponse.redirect(home, 302)

  // Validate the optional tv id so a spoofed value can't break the FK insert, and
  // denormalize the venue (id + type) onto the scan for per-venue-type reporting.
  const tvParam = url.searchParams.get('t')
  let tvId: string | null = null
  let venueId: string | null = null
  let venueType: string | null = null
  if (tvParam && UUID.test(tvParam)) {
    const { data: tv } = await supabase
      .from('tvs')
      .select('id, venue:venues(id, venue_type)')
      .eq('id', tvParam)
      .maybeSingle()
    const row = tv as unknown as { id: string; venue: { id: string; venue_type: string | null } | null } | null
    tvId = row?.id ?? null
    venueId = row?.venue?.id ?? null
    venueType = row?.venue?.venue_type ?? null
  }

  const ua = req.headers.get('user-agent')
  const bot = isBot(ua)
  const fwd = req.headers.get('x-forwarded-for')
  const ip = fwd ? fwd.split(',')[0].trim() : req.headers.get('x-real-ip')
  const ipHash = hashIp(ip)

  // Dedup: a real person tapping the same ad's QR twice (or a browser prefetch +
  // real load) shouldn't count twice. Suppress a non-bot scan with the same
  // ad + ip_hash inside the window. Bots are recorded (flagged) but never dedup-
  // gated, and a scan with no ip_hash always logs (can't dedup what we can't key).
  let isDuplicate = false
  if (!bot && ipHash) {
    const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString()
    const { data: recent } = await supabase
      .from('qr_scans')
      .select('id')
      .eq('ad_id', ad.id)
      .eq('ip_hash', ipHash)
      .gte('scanned_at', since)
      .limit(1)
      .maybeSingle()
    isDuplicate = !!recent
  }

  if (!isDuplicate) {
    await supabase.from('qr_scans').insert({
      ad_id: ad.id,
      tv_id: tvId,
      venue_id: venueId,
      venue_type: venueType,
      user_agent: ua,
      ip_hash: ipHash,
      referrer: req.headers.get('referer'),
      is_bot: bot,
    })
  }

  // Only ever redirect to an http(s) destination — never javascript:, data:, etc.
  let dest = home
  if (ad.qr_target_url) {
    try {
      const u = new URL(ad.qr_target_url)
      if (u.protocol === 'http:' || u.protocol === 'https:') dest = u
    } catch {
      /* malformed target → fall back to home */
    }
  }
  return NextResponse.redirect(dest, 302)
}

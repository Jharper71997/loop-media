import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

// QR redirect + scan logger. The QR on a screen encodes /r/<ad_id>?t=<tv_id>;
// scanning it logs a qr_scans row (hashed IP, never raw) and 302s to the ad's
// destination. Runs with the service role (qr_scans is admin-write).
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function hashIp(ip: string | null): string | null {
  if (!ip) return null
  const salt = process.env.CRON_SECRET || 'loop-media'
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

  // Validate the optional tv id so a spoofed value can't break the FK insert.
  const tvParam = url.searchParams.get('t')
  let tvId: string | null = null
  if (tvParam && UUID.test(tvParam)) {
    const { data: tv } = await supabase.from('tvs').select('id').eq('id', tvParam).maybeSingle()
    tvId = tv?.id ?? null
  }

  const fwd = req.headers.get('x-forwarded-for')
  const ip = fwd ? fwd.split(',')[0].trim() : req.headers.get('x-real-ip')
  await supabase.from('qr_scans').insert({
    ad_id: ad.id,
    tv_id: tvId,
    user_agent: req.headers.get('user-agent'),
    ip_hash: hashIp(ip),
    referrer: req.headers.get('referer'),
  })

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

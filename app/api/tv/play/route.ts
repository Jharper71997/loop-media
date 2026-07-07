import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deviceSecretOk } from '@/lib/tv'
import { rateLimit } from '@/lib/rateLimit'

// Logs one ad play. The TV display calls this each time an ad slide starts, so
// we have real "times shown" counts (vs foot-traffic estimates). Anonymous —
// runs with the service-role client; resolves the screen from its device_id and
// verifies its per-device secret (0036) so a leaked device_id can't inflate plays.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const device = String(body.device_id ?? '')
  const adId = String(body.ad_id ?? '')
  if (!device || !adId) {
    return NextResponse.json({ error: 'Missing device_id or ad_id.' }, { status: 400 })
  }

  // Lenient per-device cap (normal is a handful of plays/min). Over the cap we
  // skip the insert rather than error the screen. Fails open on limiter error.
  if (!(await rateLimit('tv_play', device, 60, 60))) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  const supabase = createAdminClient()
  const { data: tv } = await supabase
    .from('tvs')
    .select('id, device_secret')
    .eq('device_id', device)
    .maybeSingle()
  if (!tv) return NextResponse.json({ error: 'Device not paired.' }, { status: 404 })
  if (!deviceSecretOk(tv.device_secret, req)) {
    return NextResponse.json({ error: 'Device secret mismatch.' }, { status: 403 })
  }

  // Only log a play if the ad is actually scheduled on this screen — otherwise a
  // leaked device_id could inflate proof-of-play counts for any ad.
  const { data: placement } = await supabase
    .from('ad_placements')
    .select('id')
    .eq('ad_id', adId)
    .eq('tv_id', tv.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!placement) {
    return NextResponse.json({ error: 'Ad is not scheduled on this screen.' }, { status: 409 })
  }

  await supabase.from('ad_plays').insert({ ad_id: adId, tv_id: tv.id })
  return NextResponse.json({ ok: true })
}

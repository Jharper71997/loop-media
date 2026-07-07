import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit, clientIp } from '@/lib/rateLimit'

// Pair a device by entering the venue's pairing code. Returns a device_id + a
// device_secret the display stores locally and presents (x-device-secret) on the
// loop / play / heartbeat calls. Anonymous, so this runs with the service-role
// client (bypasses RLS).
//
// The pairing code is REUSABLE and permanent (a host can re-view it on their
// dashboard and re-add a device after turning a screen off). Hardening (2026-07):
//   * Rate-limited by IP so the code space can't be brute-forced.
//   * A code bound to a LIVE screen (beat within LIVE_WINDOW_MS) is NOT re-pairable
//     — that used to silently evict the running device (a hijack + DoS). An offline
//     screen still re-pairs; to move a live one, an admin regenerates its code
//     (which clears the binding), the explicit "move screen" path.
//   * Each pair mints a fresh device_secret so a leaked device_id alone can't
//     impersonate the screen.
const LIVE_WINDOW_MS = 10 * 60 * 1000

export async function POST(req: Request) {
  // Throttle by IP: a valid code binds a device, so an unthrottled endpoint over a
  // guessable code is a network-wide hijack/DoS lever. Fails open on limiter error.
  if (!(await rateLimit('tv_pair', clientIp(req), 5, 60))) {
    return NextResponse.json(
      { error: 'Too many attempts. Wait a minute and try again.' },
      { status: 429 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const code = String(body.pairing_code ?? '').trim().toUpperCase()
  if (!code) {
    return NextResponse.json({ error: 'Enter a pairing code.' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data: tv } = await supabase
    .from('tvs')
    .select('id, device_id, last_heartbeat_at')
    .eq('pairing_code', code)
    .maybeSingle()

  if (!tv) {
    return NextResponse.json({ error: 'That pairing code was not found.' }, { status: 404 })
  }

  // Refuse to steal a screen that is currently live on another device.
  const lastBeat = tv.last_heartbeat_at ? new Date(tv.last_heartbeat_at).getTime() : 0
  if (tv.device_id && Date.now() - lastBeat < LIVE_WINDOW_MS) {
    return NextResponse.json(
      {
        error:
          'This screen is already active on another device. To move it, regenerate the code from your dashboard.',
      },
      { status: 409 }
    )
  }

  const device_id = randomUUID()
  const device_secret = randomUUID()
  const now = new Date().toISOString()
  // Bind a fresh device_id + secret, KEEPING the code so it can be reused later.
  // Guard on pairing_code in the filter so a concurrent code rotation can't be
  // clobbered.
  const { data: claimed } = await supabase
    .from('tvs')
    .update({
      device_id,
      device_secret,
      status: 'online',
      last_sync_at: now,
      last_heartbeat_at: now,
    })
    .eq('id', tv.id)
    .eq('pairing_code', code)
    .select('id')
    .maybeSingle()

  if (!claimed) {
    return NextResponse.json(
      { error: 'That pairing code is no longer valid. Check the code on your dashboard and try again.' },
      { status: 409 }
    )
  }

  return NextResponse.json({ device_id, device_secret })
}

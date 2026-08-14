import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deviceSecretOk } from '@/lib/tv'
import { rateLimit } from '@/lib/rateLimit'

// Lightweight ping so admins see the screen as online + a fresh "last seen".
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const device = String(body.device_id ?? '')
  if (!device) {
    return NextResponse.json({ error: 'Missing device_id.' }, { status: 400 })
  }
  // Lenient per-device cap (normal cadence is ~2/min). Fails open on limiter error.
  if (!(await rateLimit('tv_heartbeat', device, 10, 60))) {
    return NextResponse.json({ ok: true, skipped: true })
  }
  const supabase = createAdminClient()
  const { data: tv, error: tvErr } = await supabase
    .from('tvs')
    .select('id, last_heartbeat_at, device_secret')
    .eq('device_id', device)
    .maybeSingle()
  // Same rule as the other tv routes: a database failure is not an unknown
  // device. This one already failed safe (an unknown device gets a cheerful 200),
  // but swallowing the error meant a Supabase blip silently stopped crediting
  // uptime while every screen still looked healthy. 503 makes it visible.
  if (tvErr) return NextResponse.json({ error: 'Lookup failed.' }, { status: 503 })
  if (!tv) return NextResponse.json({ ok: true })
  // A device WITH a secret must present it; a mismatched secret is a spoof.
  if (!deviceSecretOk(tv.device_secret, req)) {
    return NextResponse.json({ error: 'Device secret mismatch.' }, { status: 403 })
  }

  const now = Date.now()
  const last = tv.last_heartbeat_at ? new Date(tv.last_heartbeat_at).getTime() : 0
  await supabase
    .from('tvs')
    .update({ status: 'online', last_heartbeat_at: new Date(now).toISOString() })
    .eq('id', tv.id)

  // Credit ACTUAL elapsed wall-clock since the last beat, not a flat 30s, and
  // cap it (audit: a flood of heartbeats was inflating uptime 30s/call; a long
  // offline gap shouldn't over-credit either). Normal ~30s cadence credits ~30.
  const elapsed = last ? Math.floor((now - last) / 1000) : 30
  const secs = Math.max(0, Math.min(elapsed, 60))
  if (secs > 0) await supabase.rpc('bump_tv_uptime', { p_tv: tv.id, p_secs: secs })
  return NextResponse.json({ ok: true })
}

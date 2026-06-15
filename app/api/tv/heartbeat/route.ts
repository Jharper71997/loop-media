import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Lightweight ping so admins see the screen as online + a fresh "last seen".
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const device = String(body.device_id ?? '')
  if (!device) {
    return NextResponse.json({ error: 'Missing device_id.' }, { status: 400 })
  }
  const supabase = createAdminClient()
  const { data: tv } = await supabase
    .from('tvs')
    .select('id, last_heartbeat_at')
    .eq('device_id', device)
    .maybeSingle()
  if (!tv) return NextResponse.json({ ok: true })

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

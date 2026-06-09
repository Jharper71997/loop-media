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
    .update({ status: 'online', last_heartbeat_at: new Date().toISOString() })
    .eq('device_id', device)
    .select('id')
    .maybeSingle()
  // Heartbeat fires every ~30s; add that to the screen's uptime for the day.
  if (tv) await supabase.rpc('bump_tv_uptime', { p_tv: tv.id, p_secs: 30 })
  return NextResponse.json({ ok: true })
}

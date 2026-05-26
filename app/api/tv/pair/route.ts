import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

// Pair a device by entering the venue's pairing code. Returns a device_id the
// display stores locally and uses for the loop + heartbeat. Anonymous, so this
// runs with the service-role client (bypasses RLS).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const code = String(body.pairing_code ?? '').trim().toUpperCase()
  if (!code) {
    return NextResponse.json({ error: 'Enter a pairing code.' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data: tv } = await supabase
    .from('tvs')
    .select('id, device_id')
    .eq('pairing_code', code)
    .maybeSingle()

  if (!tv) {
    return NextResponse.json({ error: 'That pairing code was not found.' }, { status: 404 })
  }

  const device_id = tv.device_id || randomUUID()
  const now = new Date().toISOString()
  await supabase
    .from('tvs')
    .update({ device_id, status: 'online', last_sync_at: now, last_heartbeat_at: now })
    .eq('id', tv.id)

  return NextResponse.json({ device_id })
}

import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

// Pair a device by entering the venue's pairing code. Returns a device_id the
// display stores locally and uses for the loop + heartbeat. Anonymous, so this
// runs with the service-role client (bypasses RLS).
//
// The pairing code is REUSABLE and permanent (host can re-view it on their
// dashboard and re-add a device after turning a screen off). Each pair mints a
// fresh device_id and binds it, keeping the code. We still NEVER echo an existing
// device_id (2026-06-14 audit): re-pairing REPLACES it, so a code can drive at
// most one live screen — any previously-bound device 404s on its next loop fetch
// and drops back to the pairing screen. Admins can still rotate a leaked code via
// "regenerate" on the dashboard.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const code = String(body.pairing_code ?? '').trim().toUpperCase()
  if (!code) {
    return NextResponse.json({ error: 'Enter a pairing code.' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data: tv } = await supabase
    .from('tvs')
    .select('id')
    .eq('pairing_code', code)
    .maybeSingle()

  if (!tv) {
    return NextResponse.json({ error: 'That pairing code was not found.' }, { status: 404 })
  }

  const device_id = randomUUID()
  const now = new Date().toISOString()
  // Bind a fresh device_id, KEEPING the code so it can be reused later. Guard on
  // pairing_code in the filter so a concurrent code rotation can't be clobbered.
  const { data: claimed } = await supabase
    .from('tvs')
    .update({
      device_id,
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

  return NextResponse.json({ device_id })
}

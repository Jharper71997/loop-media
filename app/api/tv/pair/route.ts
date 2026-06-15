import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

// Pair a device by entering the venue's pairing code. Returns a device_id the
// display stores locally and uses for the loop + heartbeat. Anonymous, so this
// runs with the service-role client (bypasses RLS).
//
// Security (2026-06-14 audit): NEVER echo an already-bound device_id — that let
// anyone with a valid code steal the screen's device_id and drive its loop /
// inflate uptime + plays. A code is consumed on first use (cleared), so it can't
// be replayed. Re-pairing a screen requires regenerating its code from the admin
// or host dashboard (which nulls device_id + issues a fresh code).
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

  if (tv.device_id) {
    return NextResponse.json(
      { error: 'This screen is already paired. Regenerate its pairing code from the dashboard to re-pair.' },
      { status: 409 }
    )
  }

  const device_id = randomUUID()
  const now = new Date().toISOString()
  // Bind the device and CONSUME the code (clear it) so it can't be reused.
  // Guard on pairing_code in the filter so two racing pairs can't both win.
  const { data: claimed } = await supabase
    .from('tvs')
    .update({
      device_id,
      pairing_code: null,
      status: 'online',
      last_sync_at: now,
      last_heartbeat_at: now,
    })
    .eq('id', tv.id)
    .eq('pairing_code', code)
    .is('device_id', null)
    .select('id')
    .maybeSingle()

  if (!claimed) {
    return NextResponse.json(
      { error: 'That pairing code was just used. Regenerate a new code from the dashboard.' },
      { status: 409 }
    )
  }

  return NextResponse.json({ device_id })
}

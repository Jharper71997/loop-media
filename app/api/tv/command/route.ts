import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deviceSecretOk } from '@/lib/tv'
import { rateLimit } from '@/lib/rateLimit'

// A screen reporting back on a command it was handed by /api/tv/loop.
//
// The ack is the whole reason the queue is worth building. "I pressed Sleep" and
// "the panel went dark" are different facts, and every remote fix before this one
// could only be confirmed by driving to the venue and looking. An ok=false ack
// with a reason ("no device owner") is just as useful: it tells you the command
// arrived and the screen COULDN'T obey, which is a different problem from a
// screen that never heard you.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const device = String(body.device_id ?? '')
  const commandId = String(body.command_id ?? '')
  if (!device || !commandId) {
    return NextResponse.json({ error: 'Missing device_id or command_id.' }, { status: 400 })
  }
  // A screen acks at most a handful of commands a minute; anything past that is a
  // loop, not a fleet. Fails open on limiter error, like the heartbeat.
  if (!(await rateLimit('tv_command_ack', device, 30, 60))) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  const supabase = createAdminClient()
  const { data: tv, error: tvErr } = await supabase
    .from('tvs')
    .select('id, device_secret')
    .eq('device_id', device)
    .maybeSingle()
  // Same rule as the other tv routes: a database failure is not an unknown
  // device, and a screen must never treat one as a reason to change its own state.
  if (tvErr) return NextResponse.json({ error: 'Lookup failed.' }, { status: 503 })
  if (!tv) return NextResponse.json({ ok: true })
  if (!deviceSecretOk(tv.device_secret, req)) {
    return NextResponse.json({ error: 'Device secret mismatch.' }, { status: 403 })
  }

  // Scoped by tv_id as well as command id: a screen can only ever close out its
  // own commands, even holding someone else's id.
  const { error } = await supabase
    .from('tv_commands')
    .update({
      acked_at: new Date().toISOString(),
      ok: body.ok === false ? false : true,
      detail: body.detail ? String(body.detail).slice(0, 500) : null,
    })
    .eq('id', commandId)
    .eq('tv_id', tv.id)
  if (error) return NextResponse.json({ error: 'Ack failed.' }, { status: 503 })
  return NextResponse.json({ ok: true })
}

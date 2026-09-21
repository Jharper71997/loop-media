import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deviceSecretOk } from '@/lib/tv'
import { isWithinOpenHours } from '@/lib/openHours'

// "Should I wake up?" — the one question a sleeping screen can still ask.
//
// When the panel is off the player is not running: the activity is paused, the
// WebView with it, and the 30s loop poll stops. So every other control in this
// system is unreachable in exactly the state you most need it. The native shell
// therefore owns this one endpoint, calls it once a minute from an alarm while
// it is asleep, and wakes the panel when the answer is yes.
//
// Deliberately read-only and tiny: it delivers nothing and acks nothing. The
// command is still handed over and acked through /api/tv/loop once the screen is
// awake and polling again, so the record of "did the screen obey" is unchanged.
export async function GET(req: Request) {
  const device = new URL(req.url).searchParams.get('device')
  if (!device) return NextResponse.json({ error: 'Missing device.' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: tvRow, error: tvErr } = await supabase
    .from('tvs')
    .select(
      'id, device_secret, sleep_when_closed, venue:venues(business_open, business_close, business_days, business_hours)'
    )
    .eq('device_id', device)
    .maybeSingle()
  // A database hiccup must never read as "stay asleep" — answer 503 so the shell
  // retries on its next minute rather than treating a failure as an instruction.
  if (tvErr) return NextResponse.json({ error: 'Lookup failed.' }, { status: 503 })
  if (!tvRow) return NextResponse.json({ error: 'Device not paired.' }, { status: 404 })

  const tv = tvRow as unknown as {
    id: string
    device_secret: string | null
    sleep_when_closed: boolean | null
    venue: {
      business_open: string | null
      business_close: string | null
      business_days: number[] | null
      business_hours: Record<string, { open: string; close: string }> | null
    } | null
  }
  if (!deviceSecretOk(tv.device_secret, req)) {
    return NextResponse.json({ error: 'Device secret mismatch.' }, { status: 403 })
  }

  // 1. Someone pressed a button. Wake and relaunch both need the panel on.
  const { data: queued } = await supabase
    .from('tv_commands')
    .select('id')
    .eq('tv_id', tv.id)
    .is('delivered_at', null)
    .in('command', ['wake', 'relaunch'])
    .limit(1)
  if ((queued ?? []).length) {
    return NextResponse.json({ wake: true, reason: 'command' })
  }

  // 2. The venue is open and this screen is asleep, which means it missed its own
  // wake alarm (a reboot at the wrong moment, a clock adjustment, a schedule
  // edited while it slept). The server knows the hours too, so the screen never
  // depends on a single alarm having survived the night.
  if (tv.sleep_when_closed && tv.venue && isWithinOpenHours(new Date(), tv.venue)) {
    return NextResponse.json({ wake: true, reason: 'open' })
  }

  // A screen with no schedule STAYS ASLEEP. This used to answer "wake" here, on
  // the reasoning that nothing should hold a panel dark with no schedule to obey
  // — which quietly undid every manual sleep about sixty seconds after it was
  // given, because a dark screen asks this question once a minute. "No schedule"
  // is not "should be lit": an admin pressing Turn screen off is a perfectly good
  // reason to be dark, and on a screen without a schedule it is the ONLY reason
  // it is ever asleep.
  //
  // Switching a schedule off while a screen sleeps is handled where it belongs,
  // in setSleepWhenClosed, which queues an explicit wake — and that arrives as
  // case 1 above, so nothing is lost by refusing to guess here.
  return NextResponse.json({ wake: false })
}

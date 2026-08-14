import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { appUrl } from '@/lib/stripe'
import { runFleetAlarm } from '@/lib/fleetAlarm'

// Fleet-outage alarm. The logic lives in lib/fleetAlarm so the daily screen-live
// cron runs it too (same Hobby cron-cap reason as the offline alerts). This route
// stays for manual / dry runs, and is what to point a more frequent schedule at:
//   curl -H "Authorization: Bearer $CRON_SECRET" ".../api/cron/fleet-watch?dry=1"
//
// Daily is far too slow for what this catches — the 2026-08-14 outage ran eight
// hours before anyone noticed. Give it "*/15 * * * *" in vercel.json when the plan
// allows a fifth cron; the check is two queries and sends at most one email per
// six hours, so the frequency costs almost nothing.
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1'

  const admin = createAdminClient()
  const out = await runFleetAlarm(admin, appUrl(), { dry })
  return NextResponse.json(out)
}

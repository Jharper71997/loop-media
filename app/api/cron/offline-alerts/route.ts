import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { appUrl } from '@/lib/stripe'
import { runOfflineAlerts } from '@/lib/offlineAlerts'

// Host offline-screen alerts. The logic lives in lib/offlineAlerts so the daily
// screen-live cron runs it too (Vercel Hobby caps the cron count, so we fold it
// into an existing cron rather than register a 5th). This route stays for manual /
// dry runs:
//   curl -H "Authorization: Bearer $CRON_SECRET" ".../api/cron/offline-alerts?dry=1"
//   ...&venue=<id>   limit to one venue
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === '1'
  const onlyVenue = url.searchParams.get('venue')

  const admin = createAdminClient()
  const out = await runOfflineAlerts(admin, appUrl(), { dry, onlyVenue })
  return NextResponse.json(out)
}

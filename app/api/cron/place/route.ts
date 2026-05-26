import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { placeCampaign } from '@/lib/placement'

// Nightly recompute: re-run the placement engine for every active campaign so
// approved ads fill any newly-available / higher-traffic screens up to their
// goal. Protected by CRON_SECRET (Vercel cron sends it as a Bearer token).
// Manual run: curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/place
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: campaigns } = await admin
    .from('campaigns')
    .select('id')
    .eq('status', 'active')

  const results = []
  for (const c of campaigns ?? []) {
    const r = await placeCampaign(c.id, admin)
    results.push({ campaign: c.id, ok: r.ok, created: r.created, screens: r.screens, reason: r.reason })
  }

  return NextResponse.json({ ran: results.length, results })
}

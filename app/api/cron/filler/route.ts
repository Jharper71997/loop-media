import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Daily filler housekeeping.
//
// Deactivate expired cards so the admin list stays honest (the TV loop already
// filters them at query time; this just flips active=false). We deliberately do
// NOT auto-generate any content: sports/events without a live feed would be
// fabricated, and the old auto "trivia of the day" text card duplicated the real
// (QR) trivia game and was removed — the live trivia join slide is the only
// trivia that shows now.
//
// Protected by CRON_SECRET (Vercel sends it as Bearer). Vercel Hobby only allows
// daily crons, so this is scheduled daily and self-contained.
// Manual run: curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/filler
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  // Fail closed: always require the Bearer (matches place/reports crons).
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  // Deactivate expired cards.
  const { data: deactivated } = await admin
    .from('filler_content')
    .update({ active: false })
    .eq('active', true)
    .not('expires_at', 'is', null)
    .lt('expires_at', nowIso)
    .select('id')

  return NextResponse.json({ deactivated: deactivated?.length ?? 0 })
}

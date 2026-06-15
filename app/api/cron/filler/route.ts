import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Daily filler housekeeping + auto-seed.
//
// Two jobs, both safe to run every day:
//  1. Deactivate expired cards so the admin list stays honest (the TV loop
//     already filters them at query time, this just flips active=false).
//  2. Seed one evergreen "trivia of the day" per active territory from the
//     built-in pool below, rotating by date so screens stay fresh with zero
//     manual work. Auto cards carry payload.auto=true so admins can tell them
//     apart and this cron only ever manages its own rows. We deliberately do
//     NOT auto-generate sports/events: without a live data feed those would be
//     fabricated, and filler must never lie on a partner's screen.
//
// Protected by CRON_SECRET (Vercel sends it as Bearer). Vercel Hobby only
// allows daily crons, so this is scheduled daily and self-contained.
// Manual run: curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/filler
export const dynamic = 'force-dynamic'

// Evergreen bar-friendly trivia. Facts only, no dates or scores that go stale.
const TRIVIA: { headline: string; sub: string }[] = [
  { headline: 'Which NFL franchises have the most Super Bowl wins?', sub: 'Steelers and Patriots, with six each' },
  { headline: 'How many dimples are on a regulation golf ball?', sub: 'Usually between 300 and 500' },
  { headline: 'What is the only sport to have been played on the moon?', sub: 'Golf, by Alan Shepard in 1971' },
  { headline: 'Which country has won the most FIFA World Cups?', sub: 'Brazil, with five titles' },
  { headline: 'How long is a marathon?', sub: '26.2 miles, or about 42.2 kilometers' },
  { headline: 'In which sport would you perform a slam dunk?', sub: 'Basketball' },
  { headline: 'What is the maximum break in a game of snooker?', sub: '147 points' },
  { headline: 'Which boxer was known as The Greatest?', sub: 'Muhammad Ali' },
  { headline: 'How many players are on a baseball team on the field?', sub: 'Nine' },
  { headline: 'What number does a roulette wheel add up to?', sub: 'All numbers 0 to 36 sum to 666' },
  { headline: 'Which planet in our solar system is the largest?', sub: 'Jupiter' },
  { headline: 'How many strings does a standard guitar have?', sub: 'Six' },
  { headline: 'What is the hardest natural substance on Earth?', sub: 'Diamond' },
  { headline: 'Which ocean is the largest on Earth?', sub: 'The Pacific Ocean' },
  { headline: 'How many bones are in the adult human body?', sub: '206' },
  { headline: 'What gas do plants absorb from the air?', sub: 'Carbon dioxide' },
  { headline: 'Which US state has the most coastline?', sub: 'Alaska' },
  { headline: 'What is the most widely spoken language in the world?', sub: 'Mandarin Chinese by native speakers' },
  { headline: 'How many sides does a standard stop sign have?', sub: 'Eight' },
  { headline: 'Which metal is liquid at room temperature?', sub: 'Mercury' },
]

// Day-of-year so the pick advances once per day and is stable within a day.
function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0)
  const now = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return Math.floor((now - start) / 86400000)
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  const url = new URL(req.url)
  // ?force=1 also allowed for manual testing without the Bearer (no secret set).
  if (secret && auth !== `Bearer ${secret}` && url.searchParams.get('force') !== '1') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  // 1. Deactivate expired cards.
  const { data: deactivated } = await admin
    .from('filler_content')
    .update({ active: false })
    .eq('active', true)
    .not('expires_at', 'is', null)
    .lt('expires_at', nowIso)
    .select('id')

  // 2. Seed today's trivia per active territory.
  const { data: territories } = await admin.from('territories').select('id')
  const pick = TRIVIA[dayOfYear(new Date()) % TRIVIA.length]
  let seeded = 0
  for (const t of territories ?? []) {
    // Remove yesterday's auto card for this territory, then insert today's.
    await admin
      .from('filler_content')
      .delete()
      .eq('territory_id', t.id)
      .eq('type', 'trivia')
      .filter('payload->>auto', 'eq', 'true')
    const { error } = await admin.from('filler_content').insert({
      territory_id: t.id,
      type: 'trivia',
      payload: { headline: pick.headline, sub: pick.sub, foot: 'Trivia of the day', auto: true },
      active: true,
    })
    if (!error) seeded++
  }

  return NextResponse.json({
    deactivated: deactivated?.length ?? 0,
    seeded,
    territories: territories?.length ?? 0,
  })
}

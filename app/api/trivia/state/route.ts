import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { roundPhase } from '@/lib/trivia'
import { resolveVenueQuestion } from '@/lib/triviaQuestions'

// Live trivia state for a venue: the current question, phase/timer, today's
// leaderboard, and (if a player id is passed) that player's answer + score.
// Polled by phones and the TV slide. Public, read-only.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const venueId = url.searchParams.get('venue')
  const playerId = url.searchParams.get('player')
  if (!venueId) return NextResponse.json({ error: 'Missing venue.' }, { status: 400 })

  const supabase = createAdminClient()

  const now = Date.now()
  // Resolve the live question via the SHARED resolver so grading (the answer
  // endpoint) always evaluates the exact question the player is shown here.
  const resolved = await resolveVenueQuestion(supabase, venueId, now)
  if (!resolved) {
    return NextResponse.json({ error: 'No questions configured.' }, { status: 503 })
  }
  const { round, question: q } = resolved
  const { phase, endsInMs } = roundPhase(now)

  // Score = the player's current STREAK of correct answers in a row. One wrong
  // answer resets them to zero — the whole game is how many you can get right in
  // a row without a miss. Window resets weekly (Monday 00:00 server time; server
  // runs UTC on Vercel, fine until per-venue tz lands). Fetch every answer this
  // week (right AND wrong), ordered by round, and walk each player's run.
  const weekStart = new Date()
  weekStart.setHours(0, 0, 0, 0)
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))
  const { data: answers } = await supabase
    .from('trivia_answers')
    .select('player_id, round, is_correct')
    .eq('venue_id', venueId)
    .gte('created_at', weekStart.toISOString())

  // CURRENT streak = walk a player's answers in round order; +1 per correct, back
  // to 0 on any miss. The final value is their live run — this is the "X in a row"
  // shown on the player's own phone (resets to 0 when they miss).
  const streakOf = (rows: { round: number; is_correct: boolean }[]): number => {
    let s = 0
    for (const r of [...rows].sort((a, b) => a.round - b.round)) s = r.is_correct ? s + 1 : 0
    return s
  }
  // BEST streak this week = the longest run of correct-in-a-row a player reached.
  // The leaderboard ranks by THIS (a weekly high score), not the current streak,
  // so getting 3 in a row and then missing doesn't wipe you off the board — your
  // best run stands until someone beats it or the weekly window resets.
  const bestStreakOf = (rows: { round: number; is_correct: boolean }[]): number => {
    let s = 0
    let best = 0
    for (const r of [...rows].sort((a, b) => a.round - b.round)) {
      s = r.is_correct ? s + 1 : 0
      if (s > best) best = s
    }
    return best
  }
  const seqByPlayer = new Map<string, { round: number; is_correct: boolean }[]>()
  for (const a of (answers ?? []) as { player_id: string; round: number; is_correct: boolean }[]) {
    const arr = seqByPlayer.get(a.player_id) ?? []
    arr.push({ round: Number(a.round), is_correct: a.is_correct })
    seqByPlayer.set(a.player_id, arr)
  }
  // Leaderboard is ranked by each player's best run of the week.
  const byPlayer = new Map<string, number>()
  for (const [pid, rows] of seqByPlayer) byPlayer.set(pid, bestStreakOf(rows))
  const top = [...byPlayer.entries()]
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
  let leaderboard: { name: string; score: number }[] = []
  if (top.length) {
    const { data: players } = await supabase
      .from('trivia_players')
      .select('id, name')
      .in('id', top.map(([id]) => id))
    const nameById = new Map(
      ((players ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name])
    )
    leaderboard = top.map(([id, score]) => ({ name: nameById.get(id) ?? '—', score }))
  }

  // This player's status for the current round + their current streak.
  let you: { answered: boolean; choiceIdx: number | null; score: number } | null = null
  if (playerId) {
    const { data: mine } = await supabase
      .from('trivia_answers')
      .select('round, choice_idx, is_correct')
      .eq('player_id', playerId)
      .gte('created_at', weekStart.toISOString())
    const rows = (mine ?? []) as { round: number; choice_idx: number; is_correct: boolean }[]
    const thisRound = rows.find((r) => Number(r.round) === round)
    const score = streakOf(rows.map((r) => ({ round: Number(r.round), is_correct: r.is_correct })))
    you = { answered: !!thisRound, choiceIdx: thisRound?.choice_idx ?? null, score }
  }

  // What's on the screens here, for a player to browse while they wait. Always
  // leads with the two house ads that play on every screen — Jville Brew Loop and
  // Loop Network itself — then any live advertisers. Real advertiser cards link
  // through /r/<ad>?t=<tv> so a tap is attributed like a scan; house cards link
  // straight to their site (adId/tvId null). Only computed for a joined player
  // (the TV's own leaderboard poll skips this).
  type Sponsor = {
    adId: string | null
    tvId: string | null
    name: string
    what: string | null
    url: string
  }
  let sponsors: Sponsor[] = []
  if (playerId) {
    // House ads (same destinations as the on-screen slides + QRs).
    const brewloop: Sponsor = {
      adId: null,
      tvId: null,
      name: 'Jville Brew Loop',
      what: 'Shared shuttle around town · $5 off',
      url: process.env.NEXT_PUBLIC_BREWLOOP_OFFER_URL || 'https://jvillebrewloop.com',
    }
    const loopNetwork: Sponsor = {
      adId: null,
      tvId: null,
      name: 'Loop Network',
      what: 'Put your business on this screen',
      url: process.env.NEXT_PUBLIC_LOOP_SITE_URL || 'https://loopnetwork.org',
    }

    const live: Sponsor[] = []
    const { data: venueTvs } = await supabase.from('tvs').select('id').eq('venue_id', venueId)
    const tvIds = ((venueTvs ?? []) as { id: string }[]).map((t) => t.id)
    if (tvIds.length) {
      const { data: pls } = await supabase
        .from('ad_placements')
        .select('tv_id, ad:ads(id, title, qr_target_url, category_id, owner_user_id, status, creative_url)')
        .in('tv_id', tvIds)
        .eq('status', 'active')
      type PRow = {
        tv_id: string
        ad: {
          id: string
          title: string
          qr_target_url: string | null
          category_id: string | null
          owner_user_id: string
          status: string
          creative_url: string | null
        } | null
      }
      const rows = ((pls ?? []) as unknown as PRow[]).filter(
        (p) => p.ad && p.ad.qr_target_url && p.ad.creative_url && ['approved', 'active'].includes(p.ad.status)
      )
      // Advertiser names + a category fallback (the ad may not carry one), then
      // category labels for the "what they do" line.
      const ownerIds = [...new Set(rows.map((p) => p.ad!.owner_user_id))]
      const nameById = new Map<string, string>()
      const ownerCat = new Map<string, string | null>()
      if (ownerIds.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, category_id')
          .in('id', ownerIds)
        for (const pr of (profs ?? []) as { id: string; full_name: string | null; category_id: string | null }[]) {
          if (pr.full_name) nameById.set(pr.id, pr.full_name)
          ownerCat.set(pr.id, pr.category_id)
        }
      }
      const catIds = [
        ...new Set(
          rows
            .map((p) => p.ad!.category_id ?? ownerCat.get(p.ad!.owner_user_id) ?? null)
            .filter((x): x is string => !!x)
        ),
      ]
      const catName = new Map<string, string>()
      if (catIds.length) {
        const { data: cats } = await supabase.from('categories').select('id, name').in('id', catIds)
        for (const c of (cats ?? []) as { id: string; name: string }[]) catName.set(c.id, c.name)
      }
      const seen = new Set<string>()
      for (const p of rows) {
        const ad = p.ad!
        if (seen.has(ad.owner_user_id)) continue
        seen.add(ad.owner_user_id)
        const catId = ad.category_id ?? ownerCat.get(ad.owner_user_id) ?? null
        live.push({
          adId: ad.id,
          tvId: p.tv_id,
          name: (ad.title || nameById.get(ad.owner_user_id) || 'Local business').trim(),
          what: catId ? catName.get(catId) ?? null : null,
          url: ad.qr_target_url as string,
        })
      }
    }

    // Brew Loop leads, live advertisers in the middle (cap so Loop Network always
    // shows), Loop Network's "advertise here" pitch closes it out.
    sponsors = [brewloop, ...live.slice(0, 6), loopNetwork]
  }

  return NextResponse.json({
    round,
    phase,
    endsInMs,
    question: { prompt: q.prompt, choices: q.choices },
    // Hide the answer until the round closes so it can't be sniffed mid-round.
    correctIdx: phase === 'results' ? q.correct_idx : null,
    leaderboard,
    you,
    sponsors,
  })
}

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { roundNumber, roundPhase, dayNumber, shuffledOrder } from '@/lib/trivia'

// Live trivia state for a venue: the current question, phase/timer, today's
// leaderboard, and (if a player id is passed) that player's answer + score.
// Polled by phones and the TV slide. Public, read-only.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const venueId = url.searchParams.get('venue')
  const playerId = url.searchParams.get('player')
  if (!venueId) return NextResponse.json({ error: 'Missing venue.' }, { status: 400 })

  const supabase = createAdminClient()

  // The polling venue's market, so local (territory-scoped) questions can be mixed
  // in with the global set for that venue.
  const { data: venueRow } = await supabase
    .from('venues')
    .select('territory_id')
    .eq('id', venueId)
    .maybeSingle()
  const venueTerritory = (venueRow?.territory_id as string | null) ?? null

  const { data: qs } = await supabase
    .from('trivia_questions')
    .select('prompt, choices, correct_idx, territory_id, venue_id')
    .eq('active', true)
    // created_at alone is not unique (seed rows share a timestamp). The id
    // tiebreaker makes the base order deterministic before the per-day shuffle.
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  const all = (qs ?? []) as {
    prompt: string
    choices: string[]
    correct_idx: number
    territory_id: string | null
    venue_id: string | null
  }[]
  // Scope: global (both null) + this venue's territory + this exact venue.
  const questions = all.filter(
    (q) =>
      (q.venue_id == null || q.venue_id === venueId) &&
      (q.territory_id == null || q.territory_id === venueTerritory)
  )
  if (!questions.length) {
    return NextResponse.json({ error: 'No questions configured.' }, { status: 503 })
  }

  const now = Date.now()
  const round = roundNumber(now)
  const { phase, endsInMs } = roundPhase(now)
  // Per-day shuffled order walked by round: same question for every poll in a round,
  // a fresh order each day, and all questions cycle before any repeats.
  const order = shuffledOrder(questions.length, dayNumber(now))
  const q = questions[order[round % questions.length]]

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

  return NextResponse.json({
    round,
    phase,
    endsInMs,
    question: { prompt: q.prompt, choices: q.choices },
    // Hide the answer until the round closes so it can't be sniffed mid-round.
    correctIdx: phase === 'results' ? q.correct_idx : null,
    leaderboard,
    you,
  })
}

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { roundNumber, roundPhase } from '@/lib/trivia'

// Live trivia state for a venue: the current question, phase/timer, today's
// leaderboard, and (if a player id is passed) that player's answer + score.
// Polled by phones and the TV slide. Public, read-only.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const venueId = url.searchParams.get('venue')
  const playerId = url.searchParams.get('player')
  if (!venueId) return NextResponse.json({ error: 'Missing venue.' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: qs } = await supabase
    .from('trivia_questions')
    .select('prompt, choices, correct_idx')
    .eq('active', true)
    // created_at alone is not unique (seed rows share a timestamp). The id
    // tiebreaker makes the order deterministic so questions[round % count] is
    // stable across polls — otherwise the question can bounce mid-round.
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  const questions = (qs ?? []) as { prompt: string; choices: string[]; correct_idx: number }[]
  if (!questions.length) {
    return NextResponse.json({ error: 'No questions configured.' }, { status: 503 })
  }

  const now = Date.now()
  const round = roundNumber(now)
  const { phase, endsInMs } = roundPhase(now)
  const q = questions[round % questions.length]

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

  // Current streak = walk a player's answers in round order; +1 per correct, back
  // to 0 on any miss. The final value is their live run.
  const streakOf = (rows: { round: number; is_correct: boolean }[]): number => {
    let s = 0
    for (const r of [...rows].sort((a, b) => a.round - b.round)) s = r.is_correct ? s + 1 : 0
    return s
  }
  const seqByPlayer = new Map<string, { round: number; is_correct: boolean }[]>()
  for (const a of (answers ?? []) as { player_id: string; round: number; is_correct: boolean }[]) {
    const arr = seqByPlayer.get(a.player_id) ?? []
    arr.push({ round: Number(a.round), is_correct: a.is_correct })
    seqByPlayer.set(a.player_id, arr)
  }
  const byPlayer = new Map<string, number>()
  for (const [pid, rows] of seqByPlayer) byPlayer.set(pid, streakOf(rows))
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

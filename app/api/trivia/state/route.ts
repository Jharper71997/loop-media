import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { roundNumber, roundPhase, CORRECT_POINTS } from '@/lib/trivia'

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
    .order('created_at', { ascending: true })
  const questions = (qs ?? []) as { prompt: string; choices: string[]; correct_idx: number }[]
  if (!questions.length) {
    return NextResponse.json({ error: 'No questions configured.' }, { status: 503 })
  }

  const now = Date.now()
  const round = roundNumber(now)
  const { phase, endsInMs } = roundPhase(now)
  const q = questions[round % questions.length]

  // Leaderboard: today's correct answers at this venue, by player.
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const { data: answers } = await supabase
    .from('trivia_answers')
    .select('player_id, is_correct')
    .eq('venue_id', venueId)
    .eq('is_correct', true)
    .gte('created_at', startOfDay.toISOString())
  const byPlayer = new Map<string, number>()
  for (const a of (answers ?? []) as { player_id: string }[]) {
    byPlayer.set(a.player_id, (byPlayer.get(a.player_id) ?? 0) + CORRECT_POINTS)
  }
  const top = [...byPlayer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
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

  // This player's status for the current round + their score today.
  let you: { answered: boolean; choiceIdx: number | null; score: number } | null = null
  if (playerId) {
    const { data: mine } = await supabase
      .from('trivia_answers')
      .select('round, choice_idx, is_correct')
      .eq('player_id', playerId)
      .gte('created_at', startOfDay.toISOString())
    const rows = (mine ?? []) as { round: number; choice_idx: number; is_correct: boolean }[]
    const thisRound = rows.find((r) => Number(r.round) === round)
    const score = rows.filter((r) => r.is_correct).length * CORRECT_POINTS
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

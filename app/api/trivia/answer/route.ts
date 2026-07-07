import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { roundNumber, roundPhase } from '@/lib/trivia'
import { verifyPlayerToken } from '@/lib/triviaToken'
import { rateLimit, clientIp } from '@/lib/rateLimit'

// Record a player's answer for the CURRENT round (server-authoritative round +
// correctness + venue; the body's round/venue are ignored). One answer per player
// per round is enforced by a DB unique constraint. The player_id must be bound to
// the phone that joined (token from /api/trivia/join) — otherwise anyone could POST
// answers as any player.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const playerId = String(body.player_id ?? '')
  const token = typeof body.token === 'string' ? body.token : undefined
  const choiceIdx = Number(body.choice_idx)
  if (!playerId || !Number.isInteger(choiceIdx)) {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }

  // Throttle by IP so a script can't hammer answers across many players.
  if (!(await rateLimit('trivia_answer', clientIp(req), 30, 60))) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })
  }

  if (!verifyPlayerToken(playerId, token)) {
    return NextResponse.json({ error: 'Rejoin the game to continue.' }, { status: 403 })
  }

  const now = Date.now()
  const round = roundNumber(now)
  const { phase } = roundPhase(now)
  if (phase !== 'question') {
    return NextResponse.json({ error: 'Too late — wait for the next question.' }, { status: 409 })
  }

  const supabase = createAdminClient()

  // Server-authoritative venue: the answer counts for the player's OWN venue, not
  // whatever the body claims (kills cross-venue spoofing).
  const { data: player } = await supabase
    .from('trivia_players')
    .select('id, venue_id')
    .eq('id', playerId)
    .maybeSingle()
  if (!player) {
    return NextResponse.json({ error: 'Rejoin the game to continue.' }, { status: 404 })
  }

  const { data: qs } = await supabase
    .from('trivia_questions')
    .select('correct_idx')
    .eq('active', true)
    // Must match the exact ordering in /api/trivia/state so grading lines up
    // with the question the player saw. created_at ties need the id tiebreaker.
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  const questions = (qs ?? []) as { correct_idx: number }[]
  if (!questions.length) return NextResponse.json({ error: 'No questions.' }, { status: 503 })
  const correctIdx = questions[round % questions.length].correct_idx
  const correct = choiceIdx === correctIdx

  const { error } = await supabase.from('trivia_answers').insert({
    player_id: playerId,
    venue_id: player.venue_id,
    round,
    choice_idx: choiceIdx,
    is_correct: correct,
  })
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'You already answered this round.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Could not record answer.' }, { status: 500 })
  }

  return NextResponse.json({ correct, correctIdx })
}

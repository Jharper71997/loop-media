import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { roundNumber, roundPhase } from '@/lib/trivia'

// Record a player's answer for the CURRENT round (server-authoritative round +
// correctness; the body's round is ignored). One answer per player per round is
// enforced by a DB unique constraint.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const playerId = String(body.player_id ?? '')
  const venueId = String(body.venue_id ?? '')
  const choiceIdx = Number(body.choice_idx)
  if (!playerId || !venueId || !Number.isInteger(choiceIdx)) {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }

  const now = Date.now()
  const round = roundNumber(now)
  const { phase } = roundPhase(now)
  if (phase !== 'question') {
    return NextResponse.json({ error: 'Too late — wait for the next question.' }, { status: 409 })
  }

  const supabase = createAdminClient()
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
    venue_id: venueId,
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

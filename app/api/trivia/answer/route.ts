import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ANSWER_SECONDS, ROUND_SECONDS, pointsFor, roundPhase } from '@/lib/trivia'
import { resolveVenueQuestion } from '@/lib/triviaQuestions'
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
  const { phase } = roundPhase(now)
  if (phase !== 'question') {
    return NextResponse.json({ error: 'Too late — wait for the next question.' }, { status: 409 })
  }
  // The round the player was looking at when they locked in. If the round has
  // since rolled, grade NOTHING rather than grade a question they never saw —
  // they'll answer the next one. (Optional for older clients that don't send it.)
  const clientRound = Number.isInteger(Number(body.round)) ? Number(body.round) : null

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

  // Grade against the SAME resolver the state endpoint uses, scoped to the
  // player's venue — so the correct_idx here is for the exact question they saw.
  const resolved = await resolveVenueQuestion(supabase, player.venue_id, now)
  if (!resolved) return NextResponse.json({ error: 'No questions.' }, { status: 503 })
  const { round, question } = resolved
  if (clientRound != null && clientRound !== round) {
    return NextResponse.json({ error: 'Too late — wait for the next question.' }, { status: 409 })
  }
  const correct = choiceIdx === question.correct_idx

  // Speed scoring. Points come from how far into the answer window THIS REQUEST
  // arrived by the server's own clock — the phone shows a live countdown of what
  // the question is worth, but it never gets to claim a number (a patched client
  // would otherwise post "1000" every round). A wrong answer banks nothing and
  // costs nothing.
  const elapsedMs = ((now / 1000) % ROUND_SECONDS) * 1000
  const points = correct ? pointsFor(Math.min(elapsedMs, ANSWER_SECONDS * 1000)) : 0

  const row = {
    player_id: playerId,
    venue_id: player.venue_id,
    round,
    choice_idx: choiceIdx,
    is_correct: correct,
  }
  let { error } = await supabase.from('trivia_answers').insert({ ...row, points })
  // Migrations here are applied by hand, so this code can reach production before
  // 0061 adds trivia_answers.points. Rather than 500 on every answer until someone
  // runs the SQL, record the answer without a score and let it start counting the
  // moment the column exists.
  if ((error as { code?: string } | null)?.code === '42703') {
    console.warn('trivia: points column missing — apply migration 0061_trivia_points.sql')
    ;({ error } = await supabase.from('trivia_answers').insert(row))
  }
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'You already answered this round.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Could not record answer.' }, { status: 500 })
  }

  return NextResponse.json({ correct, correctIdx: question.correct_idx, points })
}

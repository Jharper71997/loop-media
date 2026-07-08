// Canonical "which question is live right now for this venue" resolver, shared by
// the trivia STATE endpoint (what the player sees) and the ANSWER endpoint (how a
// tap is graded). These MUST select + order + shuffle questions identically — if
// they diverge, a correct answer is graded against a different question and
// silently doesn't count. Keeping the logic in one place is what guarantees they
// stay in lockstep.
import { createAdminClient } from '@/lib/supabase/admin'
import { roundNumber, dayNumber, shuffledOrder } from '@/lib/trivia'

type Db = ReturnType<typeof createAdminClient>

export type TriviaQuestion = { prompt: string; choices: string[]; correct_idx: number }

export async function resolveVenueQuestion(
  supabase: Db,
  venueId: string,
  nowMs: number = Date.now()
): Promise<{ round: number; count: number; question: TriviaQuestion } | null> {
  // The venue's market, so territory-scoped questions mix in with the globals.
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
    // created_at alone is not unique (seed rows share a timestamp); the id
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
  if (!questions.length) return null

  const round = roundNumber(nowMs)
  // Per-day shuffled order walked by round: same question for every poll in a
  // round, a fresh order each day, all questions cycle before any repeat.
  const order = shuffledOrder(questions.length, dayNumber(nowMs))
  const q = questions[order[round % questions.length]]
  return {
    round,
    count: questions.length,
    question: { prompt: q.prompt, choices: q.choices, correct_idx: q.correct_idx },
  }
}

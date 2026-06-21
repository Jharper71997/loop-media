// Phone trivia game — shared round timing.
//
// Rounds come from the wall clock so every phone and the TV stay in sync with no
// server tick: a round is a fixed window, and the live question is
// questions[round % count]. The first part of each round accepts answers, the
// rest shows results + the leaderboard.

export const ROUND_SECONDS = 30
export const ANSWER_SECONDS = 22
export const CORRECT_POINTS = 100

export type Phase = 'question' | 'results'

export function roundNumber(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / ROUND_SECONDS)
}

export function roundPhase(nowMs: number = Date.now()): { phase: Phase; endsInMs: number } {
  const inRound = (nowMs / 1000) % ROUND_SECONDS
  if (inRound < ANSWER_SECONDS) {
    return { phase: 'question', endsInMs: Math.round((ANSWER_SECONDS - inRound) * 1000) }
  }
  return { phase: 'results', endsInMs: Math.round((ROUND_SECONDS - inRound) * 1000) }
}

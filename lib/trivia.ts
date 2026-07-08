// Phone trivia game — shared round timing.
//
// Rounds come from the wall clock so every phone and the TV stay in sync with no
// server tick: a round is a fixed window, and the live question is
// questions[round % count]. The first part of each round accepts answers, the
// rest shows results + the leaderboard.

// Longer rounds so a question stays put long enough to read + answer on a bar TV
// and doesn't churn between trivia-slide appearances (60s: 45s to answer, 15s
// results). Both the phones and the TV derive rounds from these, so they stay in
// sync automatically.
export const ROUND_SECONDS = 60
export const ANSWER_SECONDS = 45
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

// UTC day index — the seed for the per-day question shuffle, so the order varies
// day to day but is identical for every poll on the same day (all phones + the TV).
export function dayNumber(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / 86400)
}

// Deterministic per-day permutation of [0..n). Seeded Fisher-Yates over an xorshift32
// PRNG so every caller on the same day computes the same order (never Math.random,
// which would bounce the live question between polls). Walk it by round to cycle all
// questions before any repeats, with a fresh order each day.
export function shuffledOrder(n: number, seed: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i)
  let s = seed >>> 0 || 1
  const next = () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >> 17
    s ^= s << 5
    s >>>= 0
    return s / 0x100000000
  }
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx
}

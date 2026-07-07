import { createHmac, timingSafeEqual } from 'node:crypto'

// Server-only. Binds a trivia player_id to the phone that joined the game, so the
// public /api/trivia/answer endpoint can't be driven with someone else's (or a
// guessed) player_id. HMAC with a server secret — the service-role key is always
// present in prod, TRIVIA_TOKEN_SECRET overrides if set. This is a low-stakes bar
// game, so the goal is just to raise the bar above "POST any player_id".
function secret(): string {
  return (
    process.env.TRIVIA_TOKEN_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'insecure-dev-secret'
  )
}

export function signPlayerToken(playerId: string): string {
  return createHmac('sha256', secret()).update(playerId).digest('base64url')
}

export function verifyPlayerToken(playerId: string, token: string | null | undefined): boolean {
  if (!token) return false
  const a = Buffer.from(token)
  const b = Buffer.from(signPlayerToken(playerId))
  return a.length === b.length && timingSafeEqual(a, b)
}

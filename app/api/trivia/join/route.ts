import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isNameAllowed } from '@/lib/profanity'
import { signPlayerToken } from '@/lib/triviaToken'

// Join a venue's trivia game from a phone. Public (no login): we mint a player
// row keyed to the venue and hand back its id, which the phone keeps locally.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const code = String(body.code ?? '').trim().toUpperCase()
  const name = String(body.name ?? '').trim().slice(0, 16)
  if (!code) return NextResponse.json({ error: 'Missing game code.' }, { status: 400 })
  if (!name) return NextResponse.json({ error: 'Enter a name.' }, { status: 400 })
  // Keep the on-screen leaderboard clean — reject profane/offensive names and let
  // the player pick another.
  if (!isNameAllowed(name)) {
    return NextResponse.json({ error: 'Please choose a different name.' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data: venue } = await supabase
    .from('venues')
    .select('id, name')
    .eq('play_code', code)
    .maybeSingle()
  if (!venue) return NextResponse.json({ error: 'Game not found.' }, { status: 404 })

  const { data: player, error } = await supabase
    .from('trivia_players')
    .insert({ venue_id: venue.id, name })
    .select('id')
    .single()
  if (error || !player) return NextResponse.json({ error: 'Could not join.' }, { status: 500 })

  // Token binds this player_id to the phone; required by /api/trivia/answer.
  return NextResponse.json({
    player_id: player.id,
    venue_id: venue.id,
    venue_name: venue.name,
    token: signPlayerToken(player.id),
  })
}

'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'
import { parseTriviaBatch, normalizePrompt } from '@/lib/triviaImport'

// Phone-trivia question bank. Admin-authored; gameplay reads via the service role
// in app/api/trivia/state. RLS (trivia_questions_admin, 0028) lets admins write.
// A question can be global (no scope) or scoped to a territory and/or a single venue.

export interface TriviaInput {
  id?: string
  prompt: string
  choices: string[] // exactly 4
  correct_idx: number // 0..3
  territory_id?: string | null
  venue_id?: string | null
  active?: boolean
}

export async function saveTriviaQuestion(input: TriviaInput) {
  await requireAdmin()
  const prompt = input.prompt.trim()
  if (!prompt) return { error: 'Enter a question.' }
  const choices = (input.choices ?? []).map((c) => c.trim())
  if (choices.length !== 4 || choices.some((c) => !c)) {
    return { error: 'Enter all four answer choices.' }
  }
  if (input.correct_idx < 0 || input.correct_idx > 3) return { error: 'Mark the correct answer.' }

  const supabase = await createClient()
  const row = {
    prompt,
    choices, // jsonb array
    correct_idx: input.correct_idx,
    territory_id: input.territory_id || null,
    venue_id: input.venue_id || null,
    active: input.active ?? true,
  }
  const { error } = input.id
    ? await supabase.from('trivia_questions').update(row).eq('id', input.id)
    : await supabase.from('trivia_questions').insert(row)
  if (error) return { error: error.message }
  revalidatePath('/admin/trivia')
  return { error: null }
}

export async function toggleTriviaQuestion(id: string, active: boolean) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase.from('trivia_questions').update({ active }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/trivia')
  return { error: null }
}

export async function deleteTriviaQuestion(id: string) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase.from('trivia_questions').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/trivia')
  return { error: null }
}

// Add a whole local bank at once (see lib/triviaImport.ts for the format).
//
// A market's local questions are the reason anyone plays: people answer what they
// recognise. Standing up a new city therefore means writing ~40 questions, and
// doing that through the one-question dialog is the difference between a market
// launching with local trivia and launching without it.
export async function importTriviaQuestions(input: {
  territoryId: string | null
  text: string
}) {
  await requireAdmin()
  const { questions, bad } = parseTriviaBatch(input.text ?? '')
  if (!questions.length) {
    return {
      error: bad.length
        ? `Nothing could be read — check the format on ${bad.length === 1 ? 'that line' : `those ${bad.length} lines`}.`
        : 'Paste some questions first.',
      added: 0,
      skipped: 0,
    }
  }

  const supabase = await createClient()
  // Skip anything the market already asks — including a global question, since a
  // local copy of one would just make it come round twice as often here.
  let scope = supabase.from('trivia_questions').select('prompt')
  scope = input.territoryId
    ? scope.or(`territory_id.is.null,territory_id.eq.${input.territoryId}`)
    : scope.is('territory_id', null)
  const { data: existing } = await scope
  const known = new Set(
    ((existing ?? []) as { prompt: string }[]).map((r) => normalizePrompt(r.prompt))
  )

  const fresh = questions.filter((q) => !known.has(normalizePrompt(q.prompt)))
  if (fresh.length) {
    const { error } = await supabase.from('trivia_questions').insert(
      fresh.map((q) => ({
        prompt: q.prompt,
        choices: q.choices,
        correct_idx: q.correct_idx,
        territory_id: input.territoryId,
        venue_id: null,
        active: true,
      }))
    )
    if (error) return { error: error.message, added: 0, skipped: 0 }
  }

  revalidatePath('/admin/trivia')
  return {
    error: null,
    added: fresh.length,
    // Already in the bank, plus lines that could not be read.
    skipped: questions.length - fresh.length + bad.length,
  }
}

// Copy one market's local questions into others. The case this exists for is a
// second city in the SAME state: the state-level questions (and, here, the Camp
// Lejeune ones) are just as local in the next town over, and re-typing them is
// how a new market ends up with no local bank at all.
//
// Copies, not shared rows — each market can then edit or retire its own.
export async function copyTriviaToMarkets(input: {
  fromTerritoryId: string
  toTerritoryIds: string[]
}) {
  await requireAdmin()
  const targets = (input.toTerritoryIds ?? []).filter((id) => id && id !== input.fromTerritoryId)
  if (!input.fromTerritoryId) return { error: 'Pick the market to copy from.', added: 0 }
  if (!targets.length) return { error: 'Pick at least one market to copy into.', added: 0 }

  const supabase = await createClient()
  const { data: srcData } = await supabase
    .from('trivia_questions')
    .select('prompt, choices, correct_idx')
    .eq('territory_id', input.fromTerritoryId)
    .eq('active', true)
    // Venue-specific questions belong to that one room, not to the market.
    .is('venue_id', null)
  const source = (srcData ?? []) as { prompt: string; choices: string[]; correct_idx: number }[]
  if (!source.length) return { error: 'That market has no local questions to copy.', added: 0 }

  const { data: existing } = await supabase
    .from('trivia_questions')
    .select('prompt, territory_id')
    .in('territory_id', targets)
  const known = new Set(
    ((existing ?? []) as { prompt: string; territory_id: string }[]).map(
      (r) => `${r.territory_id}|${normalizePrompt(r.prompt)}`
    )
  )

  const rows = targets.flatMap((territory_id) =>
    source
      .filter((q) => !known.has(`${territory_id}|${normalizePrompt(q.prompt)}`))
      .map((q) => ({
        prompt: q.prompt,
        choices: q.choices,
        correct_idx: q.correct_idx,
        territory_id,
        venue_id: null,
        active: true,
      }))
  )
  if (rows.length) {
    const { error } = await supabase.from('trivia_questions').insert(rows)
    if (error) return { error: error.message, added: 0 }
  }

  revalidatePath('/admin/trivia')
  return { error: null, added: rows.length }
}

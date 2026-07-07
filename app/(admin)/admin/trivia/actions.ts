'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'

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

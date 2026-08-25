'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'

// Working the call list has to change the call list, or it is a report.

/**
 * Record that you reached out. Clears the follow-up you had promised and stamps
 * the touch, which is what moves the row from "you promised" down to "going
 * cold" — and stops it being the first thing you see tomorrow morning.
 *
 * Deliberately does NOT set a new next_step: what happens next depends on how
 * the call went, and guessing it here would fill the pipeline with follow-ups
 * nobody agreed to. Set it on the opportunity when you know.
 */
export async function logTouch(opportunityId: string) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from('opportunities')
    .update({ last_touch_at: new Date().toISOString(), next_step_at: null })
    .eq('id', opportunityId)
  if (error) return { error: error.message }
  revalidatePath('/admin/sell')
  revalidatePath('/admin/pipeline')
  return { error: null }
}

/**
 * Push a follow-up out by N days, keeping the promise but moving it. The list
 * needs this for the same reason the board needs a snooze: a queue you cannot
 * defer is a queue you abandon.
 */
export async function pushFollowUp(opportunityId: string, days: number) {
  await requireAdmin()
  const supabase = await createClient()
  const when = new Date(Date.now() + days * 86_400_000)
  // Morning of that day, not this time of day — a follow-up is a day's work,
  // not an appointment.
  when.setHours(9, 0, 0, 0)
  const { error } = await supabase
    .from('opportunities')
    .update({ next_step_at: when.toISOString() })
    .eq('id', opportunityId)
  if (error) return { error: error.message }
  revalidatePath('/admin/sell')
  revalidatePath('/admin/pipeline')
  return { error: null }
}

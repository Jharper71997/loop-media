'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'
import type { Severity } from '@/lib/caseTypes'

// Dismissing a case. See lib/caseDismissals.ts for why a derived list needs
// somewhere to store "I know" — and for the two rules that bring one back.

export type DismissInput = { caseId: string; severity: Severity; moneyCents: number }

/**
 * Snooze one or more cases. `days` null means "until it changes": no clock, but
 * the case still reappears the moment it gets worse than it is right now.
 *
 * The severity and money come from the caller because the board already has
 * them — recomputing loadCases() here just to read two numbers off a row would
 * cost a full board rebuild per click.
 */
export async function dismissCases(items: DismissInput[], days: number | null, reason?: string) {
  const profile = await requireAdmin()
  if (!items.length) return { error: null }

  const until =
    days == null ? null : new Date(Date.now() + days * 86_400_000).toISOString()

  const supabase = await createClient()
  const { error } = await supabase.from('case_dismissals').upsert(
    items.map((i) => ({
      case_id: i.caseId,
      until,
      severity: i.severity,
      money_cents: i.moneyCents,
      reason: reason?.trim() || null,
      dismissed_by: profile.id,
      // A re-dismissal is a new decision about the case as it stands now, so the
      // snapshot is overwritten rather than kept from the first time.
      created_at: new Date().toISOString(),
    })),
    { onConflict: 'case_id' }
  )
  if (error) return { error: error.message }

  revalidatePath('/admin')
  return { error: null }
}

/** Put a dismissed case back on the board immediately. */
export async function restoreCase(caseId: string) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase.from('case_dismissals').delete().eq('case_id', caseId)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { error: null }
}

/** Un-snooze everything at once — the way back from an over-enthusiastic clear. */
export async function restoreAllCases() {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase.from('case_dismissals').delete().not('case_id', 'is', null)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { error: null }
}

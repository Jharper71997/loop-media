// Reading dismissals — the server half.
//
// The rules for WHEN a dismissal expires are pure and live in lib/caseTypes.ts,
// so the board and the clear button can import them into a client bundle. This
// file is only the database read, and is server-only: it touches the cookie-
// scoped Supabase client.
//
// Why any of this exists: every case is derived — loadCases() recomputes the
// whole list from live data on each load — so there is no row to tick off.
// Without somewhere to record "I know, leave me alone", the board can only ever
// grow, and a list that never empties is a list you stop opening. That was the
// real complaint about Today: not that the cases were wrong, but that having
// handled one changed nothing.
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { Dismissal, Severity } from '@/lib/caseTypes'

export type { Dismissal } from '@/lib/caseTypes'
export { stillDismissed, reopenThreshold, SNOOZE_OPTIONS } from '@/lib/caseTypes'

/**
 * Every dismissal on record, by case id. Expired rows are left in the table on
 * purpose — they are the history of what has been waved off and when, which is
 * worth more than the handful of rows it costs.
 */
export const loadDismissals = cache(async (): Promise<Map<string, Dismissal>> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('case_dismissals')
    .select('case_id, until, severity, money_cents, reason, created_at')
  if (error) {
    // A board that fails open shows too much. A board that fails closed hides a
    // dark screen. Show everything and say why.
    console.error('case_dismissals read failed:', error.message)
    return new Map()
  }
  const out = new Map<string, Dismissal>()
  for (const r of (data ?? []) as {
    case_id: string
    until: string | null
    severity: string
    money_cents: number
    reason: string | null
    created_at: string
  }[]) {
    out.set(r.case_id, {
      caseId: r.case_id,
      until: r.until,
      severity: r.severity as Severity,
      moneyCents: r.money_cents,
      reason: r.reason,
      createdAt: r.created_at,
    })
  }
  return out
})

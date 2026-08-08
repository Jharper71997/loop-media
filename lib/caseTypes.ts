// The shape of a case, with no data access attached.
//
// Split out from lib/cases.ts on purpose: the board and the case shell are
// Client Components, and lib/cases.ts reaches for the server Supabase client
// (and through it `next/headers`), which a client bundle cannot import. Types
// and label maps live here so both sides can share them.

export type CaseKind =
  | 'screen-dark'
  | 'under-delivery'
  | 'no-results'
  | 'free-rider'
  | 'money-overdue'
  | 'unsold'
  | 'host-owed'
  | 'airing-after-cancel'
  | 'task'

// critical = money is actively bleeding or a customer is being short-changed.
// warning  = it will become critical if ignored.
// opening  = money on the table, nothing broken.
// task     = something waiting on a human, no dollars attached.
export type Severity = 'critical' | 'warning' | 'opening' | 'task'

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  opening: 2,
  task: 3,
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Broken',
  warning: 'At risk',
  opening: 'Opportunity',
  task: 'To do',
}

export interface Case {
  /** Stable across reloads: `${kind}:${subjectId}`. */
  id: string
  kind: CaseKind
  severity: Severity
  /** Who or what this is about. */
  title: string
  /** One line of evidence — the reason this is on the list, never a category name. */
  summary: string
  /** Monthly dollars at stake, in cents. 0 for tasks. */
  moneyCents: number
  /** How that money reads: at risk, comped away, or unsold. */
  moneyNote: string
  /** When the problem started, so "oldest first" means "has been broken longest". */
  since: string | null
  /** Case page, or an existing page when the fix lives somewhere that already works. */
  href: string
  subjectId: string
}

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

// ---------------------------------------------------------------------------
// Dismissals
// ---------------------------------------------------------------------------
// Here for the same reason everything else in this file is: the board and the
// clear button are Client Components, and lib/caseDismissals.ts reaches for the
// server Supabase client (and through it `next/headers`), which a client bundle
// cannot import. The shape of a dismissal and the rules for when one expires are
// pure, so they live on this side and both halves share them.

export interface Dismissal {
  caseId: string
  /** Null means "until it changes" — no clock, but the worsening rule still runs. */
  until: string | null
  severity: Severity
  moneyCents: number
  reason: string | null
  createdAt: string
}

// How much a case has to grow before a dismissal stops covering it. The ratio
// handles big numbers, the floor handles small ones — without it a case
// dismissed at $0 (a host owed screens, a task) could never reopen on money at
// all, because any multiple of zero is still zero.
const WORSE_RATIO = 1.25
const WORSE_FLOOR_CENTS = 1_000

export function reopenThreshold(dismissedCents: number): number {
  return Math.max(Math.round(dismissedCents * WORSE_RATIO), dismissedCents + WORSE_FLOOR_CENTS)
}

/**
 * Is this dismissal still covering this case?
 *
 * Returns false — meaning show the case — when the snooze has expired, when the
 * severity has climbed, or when the money has grown past the threshold above.
 * You are dismissing THIS problem, never its future.
 */
export function stillDismissed(c: Case, d: Dismissal | undefined, now = Date.now()): boolean {
  if (!d) return false
  if (d.until && new Date(d.until).getTime() <= now) return false
  // A lower rank is a worse problem: critical is 0, task is 3.
  if (SEVERITY_RANK[c.severity] < SEVERITY_RANK[d.severity]) return false
  if (c.moneyCents >= reopenThreshold(d.moneyCents)) return false
  return true
}

/** The snooze lengths offered on a row. Null is "until it changes". */
export const SNOOZE_OPTIONS: { id: string; label: string; days: number | null }[] = [
  { id: 'today', label: 'Rest of today', days: 1 },
  { id: 'week', label: '7 days', days: 7 },
  { id: 'month', label: '30 days', days: 30 },
  { id: 'changed', label: 'Until it changes', days: null },
]

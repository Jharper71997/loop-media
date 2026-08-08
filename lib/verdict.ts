// "What is wrong with this record", answered by the same engine as the board.
//
// The case pages already lead with a verdict, and it is the thing that makes
// them readable under pressure. Record pages did not, so you could open an
// advertiser, see four healthy-looking stat cards, and have no idea they had a
// dark screen and an overdue invoice — both of which were sitting on Today.
//
// This resolves a record to its open cases rather than re-deriving anything, so
// a record page and the board can never disagree. loadCases is React-cached, so
// on a page that already loaded it this costs nothing; the fan-out it does
// (one play count per ad) must never be re-run here.
import { loadCases, type Case } from '@/lib/cases'
import { loadBillingRows } from '@/lib/adminInbox'
import { createClient } from '@/lib/supabase/server'
import { SEVERITY_RANK, type Severity } from '@/lib/caseTypes'

export type VerdictSubject =
  | { kind: 'advertiser'; id: string }
  | { kind: 'venue'; id: string }
  | { kind: 'screen'; id: string }

export interface Verdict {
  severity: Severity | null
  cases: Case[]
  moneyCents: number
}

/**
 * Case.subjectId is keyed differently per kind — a screen for screen-dark, a
 * campaign for the money and delivery kinds, a venue for unsold, a host profile
 * for host-owed — so mapping a record to its cases means resolving through
 * whatever that record owns. This is the only place that mapping lives.
 */
export async function loadVerdict(
  subject: VerdictSubject,
  territoryId: string | null
): Promise<Verdict> {
  const { cases } = await loadCases(territoryId)
  let ids: string[] = []

  if (subject.kind === 'advertiser') {
    const billing = await loadBillingRows(territoryId)
    ids = [
      subject.id, // host-owed is keyed by the profile
      ...billing.filter((b) => b.advertiserId === subject.id).map((b) => b.campaignId),
    ]
  } else if (subject.kind === 'venue') {
    const supabase = await createClient()
    const { data } = await supabase.from('tvs').select('id').eq('venue_id', subject.id)
    ids = [subject.id, ...((data ?? []) as { id: string }[]).map((t) => t.id)]
  } else {
    ids = [subject.id]
  }

  const mine = cases.filter((c) => ids.includes(c.subjectId))
  mine.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.moneyCents - a.moneyCents)

  return {
    severity: mine[0]?.severity ?? null,
    cases: mine,
    moneyCents: mine.reduce((s, c) => s + c.moneyCents, 0),
  }
}

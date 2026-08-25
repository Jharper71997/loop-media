// The call list — one ranked queue of who to contact and why, right now.
//
// Selling used to be spread across four destinations that each held a third of
// an answer: /admin/pipeline knew who was mid-conversation, /admin/sell knew
// which rooms had spots, /admin/advertisers knew who was already paying, and the
// follow-up you promised on a call lived only as a badge count. Working the list
// meant opening all four, holding them in your head, and deciding an order.
// That is not a list, it is homework.
//
// So the order is computed here, once, from every source at the same time:
//
//   1. Follow-ups you promised and owe TODAY, overdue first. You said you would.
//   2. Open deals with no next step — the ones that go quiet and die.
//   3. Rooms with spots to sell, richest first.
//   4. Hosts owed free screens they have never taken up.
//
// Every entry carries a phone number, an email, and one line saying why it is on
// the list, because a call list that makes you go and look something up before
// you can dial is a list you work once.
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { loadInventory } from '@/lib/inventory'
import { loadHostBenefits } from '@/lib/hostBenefit'
import { isMissingTable } from '@/lib/opportunities'
import { formatCents } from '@/lib/format'

export type CallReason = 'promised' | 'going-cold' | 'has-room' | 'owed'

export interface CallEntry {
  id: string
  reason: CallReason
  /** Who to call. */
  name: string
  /** The human, when we know which human. */
  contactName: string | null
  phone: string | null
  email: string | null
  /** One line: why this is on today's list. */
  why: string
  /** Monthly dollars in play, for ordering within a reason. */
  moneyCents: number
  /** Where the record lives, for context before or after the call. */
  href: string
  /** When it went on the list, so "oldest first" is available. */
  since: string | null
  /** Only set for a promised follow-up that has already slipped. */
  overdue: boolean
}

// Reason ranks the list. Inside a reason, money breaks the tie — see sortCalls.
// A promise you made outranks an opportunity you spotted, always: the first has
// someone on the other end waiting, the second does not.
export const REASON_RANK: Record<CallReason, number> = {
  promised: 0,
  'going-cold': 1,
  'has-room': 2,
  owed: 3,
}

export const REASON_LABEL: Record<CallReason, string> = {
  promised: 'You promised',
  'going-cold': 'Going cold',
  'has-room': 'Room to sell',
  owed: 'We owe them',
}

export const REASON_NOTE: Record<CallReason, string> = {
  promised: 'A follow-up you committed to, due today or already past.',
  'going-cold': 'An open deal with nothing scheduled. This is how they die.',
  'has-room': 'Live screens with spots nobody is paying for.',
  owed: 'A host running fewer free screens than hosting earns them.',
}

/** Days since a timestamp, or null when there is nothing on record. */
function daysSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

export function sortCalls(rows: CallEntry[]): CallEntry[] {
  return [...rows].sort(
    (a, b) =>
      REASON_RANK[a.reason] - REASON_RANK[b.reason] ||
      // Overdue before merely due, within the promises.
      Number(b.overdue) - Number(a.overdue) ||
      b.moneyCents - a.moneyCents ||
      a.name.localeCompare(b.name)
  )
}

type OppRow = {
  id: string
  business_name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  kind: string
  stage: string
  monthly_cents: number | null
  next_step: string | null
  next_step_at: string | null
  last_touch_at: string | null
  created_at: string
}

export const loadCallList = cache(async (territoryId: string | null): Promise<CallEntry[]> => {
  const supabase = await createClient()

  // End of today, so something due later today is already work — a follow-up you
  // have not made at 9am is not a future problem, it is this morning's job.
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)

  let oq = supabase
    .from('opportunities')
    .select(
      'id, business_name, contact_name, phone, email, kind, stage, monthly_cents, next_step, next_step_at, last_touch_at, created_at'
    )
    .eq('status', 'open')
  if (territoryId) oq = oq.eq('territory_id', territoryId)

  const [{ data: oppData, error: oppError }, inventory, hosts] = await Promise.all([
    oq,
    loadInventory(territoryId),
    loadHostBenefits(territoryId),
  ])

  if (oppError && !isMissingTable(oppError)) {
    console.error('[callList] opportunities read failed:', oppError.message)
  }

  const out: CallEntry[] = []

  // ---- 1 & 2: the pipeline ------------------------------------------------
  for (const r of (oppData ?? []) as OppRow[]) {
    const money = r.monthly_cents ?? 0
    const href = `/admin/pipeline/${r.id}`
    const base = {
      id: `opp:${r.id}`,
      name: r.business_name,
      contactName: r.contact_name,
      phone: r.phone,
      email: r.email,
      moneyCents: money,
      href,
    }

    if (r.next_step_at && new Date(r.next_step_at) <= endOfToday) {
      const late = daysSince(r.next_step_at) ?? 0
      out.push({
        ...base,
        reason: 'promised',
        why: r.next_step
          ? `${r.next_step}${late > 0 ? ` · ${late} day${late === 1 ? '' : 's'} late` : ' · due today'}`
          : late > 0
            ? `Follow-up was due ${late} day${late === 1 ? '' : 's'} ago`
            : 'Follow-up due today',
        since: r.next_step_at,
        overdue: late > 0,
      })
      continue
    }

    // Nothing scheduled at all. A deal with no next step is not "in the
    // pipeline", it is a business you talked to once — and the longer it has
    // been, the closer it is to being someone else's customer.
    if (!r.next_step_at) {
      const quiet = daysSince(r.last_touch_at ?? r.created_at)
      out.push({
        ...base,
        reason: 'going-cold',
        why:
          quiet == null
            ? `At ${r.stage} with nothing scheduled`
            : `At ${r.stage} · nothing scheduled, quiet ${quiet} day${quiet === 1 ? '' : 's'}`,
        since: r.last_touch_at ?? r.created_at,
        overdue: false,
      })
    }
  }

  // ---- 3: rooms with spots to sell ----------------------------------------
  // Live screens only. An empty spot on a screen that is not running is not
  // something you can sell this week, it is an install.
  for (const v of inventory.rows) {
    if (!v.active || v.open <= 0 || v.liveScreens === 0) continue
    out.push({
      id: `venue:${v.venueId}`,
      reason: 'has-room',
      name: v.name,
      contactName: v.contact.name ?? v.hostName,
      phone: v.contact.phone,
      email: v.contact.email,
      why: [
        `${v.open} of ${v.totalSlots} spots open at ${formatCents(v.priceCents)}/mo`,
        // Host protection is the one thing that can sink a pitch after you have
        // made it, so it travels WITH the call, not on a page behind it.
        v.ownCategory ? `never sell ${v.ownCategory} here` : null,
        v.runningTitles.length ? `already here: ${v.runningTitles.slice(0, 3).join(', ')}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      moneyCents: v.openValueCents,
      href: `/admin/venues/${v.venueId}`,
      since: null,
      overdue: false,
    })
  }

  // ---- 4: hosts we owe ----------------------------------------------------
  for (const h of hosts) {
    if (h.gap <= 0) continue
    out.push({
      id: `host:${h.hostId}`,
      reason: 'owed',
      name: h.name,
      contactName: h.name,
      phone: h.phone,
      email: h.email,
      why:
        h.using === 0
          ? `Hosts ${h.hostedTvs} screen${h.hostedTvs === 1 ? '' : 's'} and has taken none of the ${h.owed} free screens that earns`
          : `Using ${h.using} of the ${h.owed} free screens hosting earns them`,
      moneyCents: 0,
      href: `/admin/cases/host-owed/${h.hostId}`,
      since: null,
      overdue: false,
    })
  }

  return sortCalls(out)
})

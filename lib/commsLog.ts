// Everything that has passed between us and anyone — one timeline.
//
// lib/activity.ts answers "what has happened to THIS record", assembled from
// half a dozen tables. This answers the other question, which had no home at
// all: "what happened today". Calls, texts and emails together, newest first,
// INCLUDING the ones from numbers we have never seen — an unmatched inbound
// call is a lead nobody wrote down, and it was previously invisible everywhere.
//
// Calls and texts arrive on their own, from the Quo webhook. Nothing here
// depends on anybody remembering to log a call after they made it.
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { isMissingTable } from '@/lib/opportunities'
import { formatPhone } from '@/lib/quo'
import type { ThreadChannel, Direction, MessageStatus } from '@/lib/messaging'

export interface CommsItem {
  id: string
  channel: ThreadChannel
  direction: Direction
  status: MessageStatus
  /** Who it was with, resolved to a name where we could. */
  who: string
  /** Null when the number matched nothing — the row is still worth showing. */
  href: string | null
  /** True when this is a stranger: the most interesting rows on the page. */
  unknown: boolean
  subject: string | null
  body: string
  durationSeconds: number | null
  answered: boolean | null
  contactPhone: string | null
  createdAt: string
}

type Row = {
  id: string
  channel: string
  direction: string
  status: string
  subject: string | null
  body: string
  duration_seconds: number | null
  answered: boolean | null
  contact_phone: string | null
  created_at: string
  opportunity: { id: string; business_name: string } | { id: string; business_name: string }[] | null
  advertiser:
    | { id: string; full_name: string | null; email: string }
    | { id: string; full_name: string | null; email: string }[]
    | null
}

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

const SELECT =
  'id, channel, direction, status, subject, body, duration_seconds, answered, contact_phone, created_at, opportunity:opportunities(id, business_name), advertiser:profiles!advertiser_id(id, full_name, email)'

const asChannel = (c: string): ThreadChannel =>
  c === 'sms' || c === 'call' ? (c as ThreadChannel) : 'email'

export interface CommsSummary {
  /** Rows in the last 24 hours, and how many of them were calls. */
  recent: number
  recentCalls: number
  /** Inbound calls nobody picked up. */
  missed: number
  /** Rows whose number matched no record — usually leads. */
  unknown: number
}

export const loadCommsLog = cache(
  async (
    territoryId: string | null,
    limit = 200
  ): Promise<{ ready: boolean; items: CommsItem[]; summary: CommsSummary }> => {
    const supabase = await createClient()
    let q = supabase
      .from('messages')
      .select(SELECT)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (territoryId) q = q.eq('territory_id', territoryId)

    const empty: CommsSummary = { recent: 0, recentCalls: 0, missed: 0, unknown: 0 }

    const { data, error } = await q
    if (error) {
      // 0069/0074 are applied by hand — the page must render rather than throw.
      if (!isMissingTable(error)) console.error('[comms] read failed:', error.message)
      return { ready: false, items: [], summary: empty }
    }

    const items = ((data ?? []) as unknown as Row[]).map((r): CommsItem => {
      const opp = one(r.opportunity)
      const adv = one(r.advertiser)
      const name = opp?.business_name ?? adv?.full_name ?? adv?.email ?? null
      return {
        id: r.id,
        channel: asChannel(r.channel),
        direction: (r.direction === 'in' ? 'in' : 'out') as Direction,
        status: r.status as MessageStatus,
        // Falling back to the number is the point: "(910) 555-0134" with no name
        // is a row you can act on. A blank is not.
        who: name ?? formatPhone(r.contact_phone) ?? 'Unknown',
        href: opp ? `/admin/pipeline/${opp.id}` : adv ? `/admin/advertisers/${adv.id}` : null,
        unknown: !opp && !adv,
        subject: r.subject,
        body: r.body,
        durationSeconds: r.duration_seconds,
        answered: r.answered,
        contactPhone: r.contact_phone,
        createdAt: r.created_at,
      }
    })

    // Counted here rather than in the page: reading the clock inside a Server
    // Component body trips react-hooks/purity, and a count over the rows we just
    // fetched belongs next to the fetch regardless.
    const dayAgo = Date.now() - 86_400_000
    const recent = items.filter((i) => new Date(i.createdAt).getTime() >= dayAgo)
    const summary: CommsSummary = {
      recent: recent.length,
      recentCalls: recent.filter((i) => i.channel === 'call').length,
      missed: items.filter((i) => i.channel === 'call' && i.answered === false && i.direction === 'in')
        .length,
      unknown: items.filter((i) => i.unknown).length,
    }

    return { ready: true, items, summary }
  }
)

/**
 * The last time we reached out to each opportunity, however we did it. Feeds the
 * call list, so a card can say "you called them yesterday" instead of putting
 * the same name in front of you the morning after you rang them.
 */
export const loadLastTouches = cache(
  async (territoryId: string | null): Promise<Map<string, { at: string; channel: ThreadChannel }>> => {
    const supabase = await createClient()
    let q = supabase
      .from('messages')
      .select('opportunity_id, channel, created_at')
      .not('opportunity_id', 'is', null)
      .eq('direction', 'out')
      .order('created_at', { ascending: false })
      .limit(1000)
    if (territoryId) q = q.eq('territory_id', territoryId)

    const { data, error } = await q
    if (error) {
      if (!isMissingTable(error)) console.error('[comms] last touches failed:', error.message)
      return new Map()
    }

    const out = new Map<string, { at: string; channel: ThreadChannel }>()
    for (const r of (data ?? []) as {
      opportunity_id: string
      channel: string
      created_at: string
    }[]) {
      // Rows arrive newest-first, so the first one wins and the rest are skipped.
      if (out.has(r.opportunity_id)) continue
      out.set(r.opportunity_id, { at: r.created_at, channel: asChannel(r.channel) })
    }
    return out
  }
)

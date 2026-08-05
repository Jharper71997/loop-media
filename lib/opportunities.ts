// Server-side reads for the sales pipeline.
//
// Every function here tolerates the tables not existing. Migration 0068 has to be
// pasted into the Supabase SQL editor by hand (there is no DATABASE_URL in this
// environment), so until that happens the pipeline pages must say so plainly
// instead of throwing — and, more importantly, the Today page and the reports
// page must keep working exactly as before.
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import {
  stagesFor,
  followUpState,
  isDue,
  type Opportunity,
  type OpportunityEvent,
  type OpportunityKind,
  type EventKind,
} from '@/lib/pipeline'

// Postgres "undefined_table", and PostgREST's schema-cache equivalent.
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205'])

export function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return !!error?.code && MISSING_TABLE_CODES.has(error.code)
}

const SELECT = `
  id, territory_id, kind, business_name, contact_name, email, phone, website,
  address, city, category_id, stage, status, monthly_cents, screens, source,
  lost_reason, next_step, next_step_at, last_touch_at, advertiser_id,
  campaign_id, venue_id, created_at, won_at, lost_at,
  category:categories(name)
`

type Row = {
  id: string
  territory_id: string
  kind: string
  business_name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  city: string | null
  category_id: string | null
  stage: string
  status: string
  monthly_cents: number | null
  screens: number | null
  source: string | null
  lost_reason: string | null
  next_step: string | null
  next_step_at: string | null
  last_touch_at: string | null
  advertiser_id: string | null
  campaign_id: string | null
  venue_id: string | null
  created_at: string
  won_at: string | null
  lost_at: string | null
  category: { name: string } | { name: string }[] | null
}

// PostgREST returns an embedded to-one either as an object or a one-element
// array depending on how it infers the relationship.
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export function toOpportunity(r: Row): Opportunity {
  return {
    id: r.id,
    territoryId: r.territory_id,
    kind: (r.kind === 'host' ? 'host' : 'advertiser') as OpportunityKind,
    businessName: r.business_name,
    contactName: r.contact_name,
    email: r.email,
    phone: r.phone,
    website: r.website,
    address: r.address,
    city: r.city,
    categoryId: r.category_id,
    categoryName: one(r.category)?.name ?? null,
    stage: r.stage,
    status: r.status === 'won' || r.status === 'lost' ? r.status : 'open',
    monthlyCents: r.monthly_cents ?? 0,
    screens: r.screens,
    source: r.source,
    lostReason: r.lost_reason,
    nextStep: r.next_step,
    nextStepAt: r.next_step_at,
    lastTouchAt: r.last_touch_at,
    advertiserId: r.advertiser_id,
    campaignId: r.campaign_id,
    venueId: r.venue_id,
    createdAt: r.created_at,
    wonAt: r.won_at,
    lostAt: r.lost_at,
  }
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export interface BoardColumn {
  key: string
  label: string
  meaning: string
  items: Opportunity[]
  valueCents: number
}

export interface Board {
  ready: boolean
  kind: OpportunityKind
  columns: BoardColumn[]
  // Recently closed, shown as a short tail rather than two more columns — a Won
  // pile that grows forever would dominate a board whose job is open work.
  won: Opportunity[]
  lost: Opportunity[]
  totals: {
    open: number
    openValueCents: number
    wonThisMonth: number
    wonThisMonthCents: number
    lostThisMonth: number
    // Won / (won + lost) over everything ever closed. Null until something closes.
    conversionPct: number | null
    dueCount: number
  }
}

export const loadBoard = cache(
  async (territoryId: string | null, kind: OpportunityKind): Promise<Board> => {
    const stages = stagesFor(kind)
    const empty: Board = {
      ready: false,
      kind,
      columns: stages.map((s) => ({ ...s, items: [], valueCents: 0 })),
      won: [],
      lost: [],
      totals: {
        open: 0,
        openValueCents: 0,
        wonThisMonth: 0,
        wonThisMonthCents: 0,
        lostThisMonth: 0,
        conversionPct: null,
        dueCount: 0,
      },
    }

    const supabase = await createClient()
    let q = supabase.from('opportunities').select(SELECT).eq('kind', kind)
    if (territoryId) q = q.eq('territory_id', territoryId)
    const { data, error } = await q.order('next_step_at', { ascending: true, nullsFirst: false })

    if (error) {
      if (!isMissingTable(error)) console.error('[pipeline] loadBoard failed:', error)
      return empty
    }

    const all = ((data ?? []) as unknown as Row[]).map(toOpportunity)
    const open = all.filter((o) => o.status === 'open')
    const won = all.filter((o) => o.status === 'won')
    const lost = all.filter((o) => o.status === 'lost')

    const columns: BoardColumn[] = stages.map((s) => {
      const items = open.filter((o) => o.stage === s.key)
      return {
        ...s,
        items,
        valueCents: items.reduce((a, o) => a + o.monthlyCents, 0),
      }
    })

    // A row whose stage is not in the current list (renamed column, bad import)
    // would otherwise vanish silently. Park it in the first column so it is still
    // workable rather than lost.
    const known = new Set(stages.map((s) => s.key))
    const orphans = open.filter((o) => !known.has(o.stage))
    if (orphans.length) {
      columns[0].items = [...columns[0].items, ...orphans]
      columns[0].valueCents += orphans.reduce((a, o) => a + o.monthlyCents, 0)
    }

    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const inMonth = (iso: string | null) => !!iso && new Date(iso) >= monthStart

    const closed = won.length + lost.length

    return {
      ready: true,
      kind,
      columns,
      won: won
        .slice()
        .sort((a, b) => (b.wonAt ?? '').localeCompare(a.wonAt ?? ''))
        .slice(0, 12),
      lost: lost
        .slice()
        .sort((a, b) => (b.lostAt ?? '').localeCompare(a.lostAt ?? ''))
        .slice(0, 12),
      totals: {
        open: open.length,
        openValueCents: open.reduce((a, o) => a + o.monthlyCents, 0),
        wonThisMonth: won.filter((o) => inMonth(o.wonAt)).length,
        wonThisMonthCents: won
          .filter((o) => inMonth(o.wonAt))
          .reduce((a, o) => a + o.monthlyCents, 0),
        lostThisMonth: lost.filter((o) => inMonth(o.lostAt)).length,
        conversionPct: closed > 0 ? Math.round((won.length / closed) * 100) : null,
        dueCount: open.filter((o) => isDue(followUpState(o.nextStepAt))).length,
      },
    }
  }
)

// ---------------------------------------------------------------------------
// One record
// ---------------------------------------------------------------------------

export async function loadOpportunity(
  id: string
): Promise<{ opportunity: Opportunity; events: OpportunityEvent[] } | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('opportunities').select(SELECT).eq('id', id).maybeSingle()
  if (error || !data) {
    if (error && !isMissingTable(error)) console.error('[pipeline] loadOpportunity failed:', error)
    return null
  }

  const { data: evData } = await supabase
    .from('opportunity_events')
    .select('id, kind, body, from_stage, to_stage, created_at, author:profiles(full_name, email)')
    .eq('opportunity_id', id)
    .order('created_at', { ascending: false })

  type EvRow = {
    id: string
    kind: string
    body: string | null
    from_stage: string | null
    to_stage: string | null
    created_at: string
    author: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null
  }

  const events: OpportunityEvent[] = ((evData ?? []) as unknown as EvRow[]).map((e) => {
    const a = one(e.author)
    return {
      id: e.id,
      kind: e.kind as EventKind,
      body: e.body,
      fromStage: e.from_stage,
      toStage: e.to_stage,
      createdAt: e.created_at,
      authorName: a?.full_name ?? a?.email ?? null,
    }
  })

  return { opportunity: toOpportunity(data as unknown as Row), events }
}

// ---------------------------------------------------------------------------
// Follow-ups due — feeds the existing Today queue rather than a second one.
// ---------------------------------------------------------------------------

export interface DueFollowUp {
  id: string
  businessName: string
  kind: OpportunityKind
  nextStep: string | null
  nextStepAt: string
  monthlyCents: number
  overdue: boolean
}

export const loadDueFollowUps = cache(
  async (territoryId: string | null): Promise<DueFollowUp[]> => {
    const supabase = await createClient()
    // End of today, so something due later today still counts as due now — a
    // follow-up you have not made yet at 9am is work, not a future problem.
    const endOfToday = new Date()
    endOfToday.setHours(23, 59, 59, 999)

    let q = supabase
      .from('opportunities')
      .select('id, business_name, kind, next_step, next_step_at, monthly_cents')
      .eq('status', 'open')
      .not('next_step_at', 'is', null)
      .lte('next_step_at', endOfToday.toISOString())
    if (territoryId) q = q.eq('territory_id', territoryId)

    const { data, error } = await q.order('next_step_at', { ascending: true })
    if (error) {
      if (!isMissingTable(error)) console.error('[pipeline] loadDueFollowUps failed:', error)
      return []
    }

    const now = Date.now()
    return (
      (data ?? []) as {
        id: string
        business_name: string
        kind: string
        next_step: string | null
        next_step_at: string
        monthly_cents: number | null
      }[]
    ).map((r) => ({
      id: r.id,
      businessName: r.business_name,
      kind: (r.kind === 'host' ? 'host' : 'advertiser') as OpportunityKind,
      nextStep: r.next_step,
      nextStepAt: r.next_step_at,
      monthlyCents: r.monthly_cents ?? 0,
      overdue: new Date(r.next_step_at).getTime() < now - 86_400_000,
    }))
  }
)

// ---------------------------------------------------------------------------
// Reporting — the real numbers behind the charts that were faking it.
// ---------------------------------------------------------------------------

export interface PipelineReport {
  ready: boolean
  // Stage distribution, per pipeline. Unit-consistent: every stage counts
  // opportunities, so the bars are comparable.
  stageCounts: { kind: OpportunityKind; stages: { label: string; value: number }[] }[]
  statusCounts: { open: number; won: number; lost: number }
  wonValueCents: number
  lostValueCents: number
  conversionPct: number | null
  // Attribution: where the deals that closed actually came from.
  bySource: { label: string; won: number; lost: number; open: number; wonCents: number }[]
}

export const loadPipelineReport = cache(
  async (territoryId: string | null, days: number): Promise<PipelineReport> => {
    const empty: PipelineReport = {
      ready: false,
      stageCounts: [],
      statusCounts: { open: 0, won: 0, lost: 0 },
      wonValueCents: 0,
      lostValueCents: 0,
      conversionPct: null,
      bySource: [],
    }

    const supabase = await createClient()
    let q = supabase.from('opportunities').select('kind, stage, status, monthly_cents, source, won_at, lost_at, created_at')
    if (territoryId) q = q.eq('territory_id', territoryId)
    const { data, error } = await q
    if (error) {
      if (!isMissingTable(error)) console.error('[pipeline] loadPipelineReport failed:', error)
      return empty
    }

    type RRow = {
      kind: string
      stage: string
      status: string
      monthly_cents: number | null
      source: string | null
      won_at: string | null
      lost_at: string | null
      created_at: string
    }
    const all = (data ?? []) as RRow[]

    // Open rows are counted regardless of age — an untouched prospect from six
    // months ago is still in the pipeline. Only CLOSED rows are windowed, so
    // "won in the last 30 days" means what it says.
    const since = new Date(Date.now() - days * 86_400_000).toISOString()
    const closedInWindow = (r: RRow) =>
      (r.status === 'won' && (r.won_at ?? r.created_at) >= since) ||
      (r.status === 'lost' && (r.lost_at ?? r.created_at) >= since)

    const open = all.filter((r) => r.status === 'open')
    const won = all.filter((r) => r.status === 'won' && closedInWindow(r))
    const lost = all.filter((r) => r.status === 'lost' && closedInWindow(r))

    const stageCounts = (['advertiser', 'host'] as OpportunityKind[])
      .map((kind) => ({
        kind,
        stages: stagesFor(kind).map((s) => ({
          label: s.label,
          value: open.filter((r) => r.kind === kind && r.stage === s.key).length,
        })),
      }))
      .filter((g) => g.stages.some((s) => s.value > 0))

    const sources = new Map<string, { won: number; lost: number; open: number; wonCents: number }>()
    const bump = (key: string | null, field: 'won' | 'lost' | 'open', cents = 0) => {
      const k = key ?? 'unknown'
      const cur = sources.get(k) ?? { won: 0, lost: 0, open: 0, wonCents: 0 }
      cur[field] += 1
      cur.wonCents += cents
      sources.set(k, cur)
    }
    open.forEach((r) => bump(r.source, 'open'))
    won.forEach((r) => bump(r.source, 'won', r.monthly_cents ?? 0))
    lost.forEach((r) => bump(r.source, 'lost'))

    const closed = won.length + lost.length

    return {
      ready: true,
      stageCounts,
      statusCounts: { open: open.length, won: won.length, lost: lost.length },
      wonValueCents: won.reduce((a, r) => a + (r.monthly_cents ?? 0), 0),
      lostValueCents: lost.reduce((a, r) => a + (r.monthly_cents ?? 0), 0),
      conversionPct: closed > 0 ? Math.round((won.length / closed) * 100) : null,
      bySource: [...sources.entries()]
        .map(([key, v]) => ({ label: key, ...v }))
        .sort((a, b) => b.won - a.won || b.open - a.open),
    }
  }
)

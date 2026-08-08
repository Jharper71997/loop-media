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
  // Both queries key off the id we already have, so the timeline never needed to
  // wait for the record to come back first.
  const [{ data, error }, { data: evData }] = await Promise.all([
    supabase.from('opportunities').select(SELECT).eq('id', id).maybeSingle(),
    supabase
      .from('opportunity_events')
      .select('id, kind, body, from_stage, to_stage, created_at, author:profiles(full_name, email)')
      .eq('opportunity_id', id)
      .order('created_at', { ascending: false }),
  ])
  if (error || !data) {
    if (error && !isMissingTable(error)) console.error('[pipeline] loadOpportunity failed:', error)
    return null
  }

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

// ---------------------------------------------------------------------------
// The opportunity dashboard — the GHL screen, in this network's units.
//
// Every figure is stated against the SAME-LENGTH window immediately before it,
// and every delta carries its raw previous value: at this size a "+300%" off a
// base of 1 is noise, and a dashboard that shouts percentages at a four-deal
// month is lying to you politely.
// ---------------------------------------------------------------------------

export interface Paired {
  current: number
  previous: number
}

export interface PipelineDashboard {
  ready: boolean
  days: number
  // Headline counts.
  opportunities: Paired
  opened: Paired
  won: Paired
  lost: Paired
  wonValueCents: Paired
  lostValueCents: number
  // Everything still open, regardless of age — the standing book of business.
  openCount: number
  openValueCents: number
  conversionPct: number | null
  // Average days from created to won, for deals won in this window.
  avgDaysToWin: number | null
  // 12 months of created vs won.
  overTime: { label: string; created: number; won: number }[]
  // Of the opportunities CREATED in this window, where did they end up.
  byStatus: { label: string; count: number; slot: 1 | 2 | 3 }[]
  // Attribution. `count` is everything attributed to the source; `won`/`cents`
  // are what it actually produced in the window.
  bySource: { key: string; label: string; count: number; won: number; lost: number; cents: number }[]
  // True funnel: how many opportunities EVER reached each stage, reconstructed
  // from the event log rather than from where a card happens to sit now.
  funnels: {
    kind: OpportunityKind
    stages: { label: string; value: number; note?: string }[]
    reachedEnd: number
  }[]
  // Open deals per stage right now.
  stageNow: { kind: OpportunityKind; stages: { label: string; value: number }[] }[]
  sparse: boolean
}

function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

export const loadPipelineDashboard = cache(
  async (territoryId: string | null, days: number): Promise<PipelineDashboard> => {
    const empty: PipelineDashboard = {
      ready: false,
      days,
      opportunities: { current: 0, previous: 0 },
      opened: { current: 0, previous: 0 },
      won: { current: 0, previous: 0 },
      lost: { current: 0, previous: 0 },
      wonValueCents: { current: 0, previous: 0 },
      lostValueCents: 0,
      openCount: 0,
      openValueCents: 0,
      conversionPct: null,
      avgDaysToWin: null,
      overTime: [],
      byStatus: [],
      bySource: [],
      funnels: [],
      stageNow: [],
      sparse: true,
    }

    const supabase = await createClient()
    let q = supabase
      .from('opportunities')
      .select('id, kind, stage, status, monthly_cents, source, created_at, won_at, lost_at')
    if (territoryId) q = q.eq('territory_id', territoryId)
    const { data, error } = await q
    if (error) {
      if (!isMissingTable(error)) console.error('[pipeline] loadPipelineDashboard failed:', error)
      return empty
    }

    type DRow = {
      id: string
      kind: string
      stage: string
      status: string
      monthly_cents: number | null
      source: string | null
      created_at: string
      won_at: string | null
      lost_at: string | null
    }
    const all = (data ?? []) as DRow[]

    const now = Date.now()
    const winMs = days * 86_400_000
    const startISO = new Date(now - winMs).toISOString()
    const prevStartISO = new Date(now - winMs * 2).toISOString()

    const inWindow = (iso: string | null) => !!iso && iso >= startISO
    const inPrev = (iso: string | null) => !!iso && iso >= prevStartISO && iso < startISO

    const cents = (rows: DRow[]) => rows.reduce((a, r) => a + (r.monthly_cents ?? 0), 0)

    const createdNow = all.filter((r) => inWindow(r.created_at))
    const createdPrev = all.filter((r) => inPrev(r.created_at))
    const wonNow = all.filter((r) => r.status === 'won' && inWindow(r.won_at))
    const wonPrev = all.filter((r) => r.status === 'won' && inPrev(r.won_at))
    const lostNow = all.filter((r) => r.status === 'lost' && inWindow(r.lost_at))
    const lostPrev = all.filter((r) => r.status === 'lost' && inPrev(r.lost_at))
    const open = all.filter((r) => r.status === 'open')

    // Days from first touch to signature, for deals won in this window. This is
    // the number that tells you whether a "hot" deal is actually moving.
    const winDurations = wonNow
      .map((r) => (r.won_at ? (new Date(r.won_at).getTime() - new Date(r.created_at).getTime()) / 86_400_000 : null))
      .filter((n): n is number => n != null && Number.isFinite(n) && n >= 0)

    // ---- 12 months of created vs won ----
    const months: string[] = []
    const cursor = new Date()
    cursor.setDate(1)
    for (let i = 11; i >= 0; i--) {
      const d = new Date(cursor)
      d.setMonth(d.getMonth() - i)
      months.push(d.toISOString().slice(0, 7))
    }
    const overTime = months.map((m) => ({
      label: m.slice(5) + '/' + m.slice(2, 4),
      created: all.filter((r) => monthKey(r.created_at) === m).length,
      won: all.filter((r) => r.won_at && monthKey(r.won_at) === m).length,
    }))

    // ---- Where this window's new opportunities ended up ----
    const byStatus: PipelineDashboard['byStatus'] = [
      { label: 'Still open', count: createdNow.filter((r) => r.status === 'open').length, slot: 1 },
      { label: 'Won', count: createdNow.filter((r) => r.status === 'won').length, slot: 3 },
      { label: 'Lost', count: createdNow.filter((r) => r.status === 'lost').length, slot: 2 },
    ]

    // ---- Attribution ----
    const srcKeys = [...new Set(all.map((r) => r.source ?? 'unknown'))]
    const bySource = srcKeys
      .map((key) => {
        const mine = all.filter((r) => (r.source ?? 'unknown') === key)
        const w = mine.filter((r) => r.status === 'won' && inWindow(r.won_at))
        return {
          key,
          label: key === 'unknown' ? 'Unknown' : key,
          count: mine.length,
          won: w.length,
          lost: mine.filter((r) => r.status === 'lost' && inWindow(r.lost_at)).length,
          cents: cents(w),
        }
      })
      .sort((a, b) => b.cents - a.cents || b.won - a.won || b.count - a.count)

    // ---- The funnel, from the event log ----
    // "Ever reached this stage" is the honest denominator. Reading current stage
    // alone would show a deal that jumped straight to Proposal as never having
    // been Contacted, and would erase every deal that has already closed.
    const reached = new Map<string, Set<string>>() // stage key -> opportunity ids
    const ids = all.map((r) => r.id)
    if (ids.length) {
      const { data: evData } = await supabase
        .from('opportunity_events')
        .select('opportunity_id, to_stage')
        .in('opportunity_id', ids)
        .not('to_stage', 'is', null)
      for (const e of (evData ?? []) as { opportunity_id: string; to_stage: string }[]) {
        if (!reached.has(e.to_stage)) reached.set(e.to_stage, new Set())
        reached.get(e.to_stage)!.add(e.opportunity_id)
      }
    }
    // Where a card sits now counts as reached, even if its move predates the log.
    for (const r of all) {
      if (!reached.has(r.stage)) reached.set(r.stage, new Set())
      reached.get(r.stage)!.add(r.id)
    }

    const funnels = (['advertiser', 'host'] as OpportunityKind[])
      .map((kind) => {
        const mine = new Set(all.filter((r) => r.kind === kind).map((r) => r.id))
        if (!mine.size) return null
        const stages = stagesFor(kind).map((s) => {
          const set = reached.get(s.key)
          const value = set ? [...set].filter((id) => mine.has(id)).length : 0
          return { label: s.label, value }
        })
        const wonCount = all.filter((r) => r.kind === kind && r.status === 'won').length
        return {
          kind,
          stages: [
            ...stages,
            { label: kind === 'host' ? 'Live' : 'Won', value: wonCount, note: 'closed' },
          ],
          reachedEnd: wonCount,
        }
      })
      .filter((f): f is NonNullable<typeof f> => f != null)

    const stageNow = (['advertiser', 'host'] as OpportunityKind[])
      .map((kind) => ({
        kind,
        stages: stagesFor(kind).map((s) => ({
          label: s.label,
          value: open.filter((r) => r.kind === kind && r.stage === s.key).length,
        })),
      }))
      .filter((g) => g.stages.some((s) => s.value > 0))

    const closedNow = wonNow.length + lostNow.length

    return {
      ready: true,
      days,
      opportunities: { current: all.length, previous: all.length - createdNow.length },
      opened: { current: createdNow.length, previous: createdPrev.length },
      won: { current: wonNow.length, previous: wonPrev.length },
      lost: { current: lostNow.length, previous: lostPrev.length },
      wonValueCents: { current: cents(wonNow), previous: cents(wonPrev) },
      lostValueCents: cents(lostNow),
      openCount: open.length,
      openValueCents: cents(open),
      conversionPct: closedNow > 0 ? Math.round((wonNow.length / closedNow) * 100) : null,
      avgDaysToWin: winDurations.length
        ? Math.round(winDurations.reduce((a, n) => a + n, 0) / winDurations.length)
        : null,
      overTime,
      byStatus,
      bySource,
      funnels,
      stageNow,
      // Below this the charts are shapes, not signal, and the page says so.
      sparse: all.length < 3,
    }
  }
)

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

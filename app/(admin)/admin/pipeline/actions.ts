'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, adminCanTerritory } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createAdminClient } from '@/lib/supabase/admin'
import { isMissingTable } from '@/lib/opportunities'
import {
  firstStage,
  isValidStage,
  stageLabel,
  type LoggableEventKind,
  type OpportunityKind,
} from '@/lib/pipeline'

// Working the pipeline.
//
// Two rules run through all of this:
//
//   1. Every state change that a person would want explained later writes an
//      opportunity_events row. Moving a card, winning, losing, changing the
//      value — the timeline is a byproduct of using the board, never a chore.
//   2. Touching an opportunity stamps last_touch_at, which is what makes "going
//      cold" visible on the card without anyone maintaining a field.
//
// The tables are created by migration 0068, which has to be pasted into the
// Supabase SQL editor by hand. Every action here turns that specific failure into
// a sentence a human can act on rather than a Postgres error code.

const MIGRATION_HINT =
  'The pipeline tables do not exist yet. Run loop-run-this-in-supabase.sql (on your Desktop) in the Supabase SQL editor, then try again.'

type Result = { error: string | null }

function revalidate(id?: string) {
  revalidatePath('/admin')
  revalidatePath('/admin/pipeline')
  revalidatePath('/admin/reports')
  if (id) revalidatePath(`/admin/pipeline/${id}`)
}

// New rows need a market. Prefer the one explicitly chosen, then the admin's own,
// then the single market they can see — a territory-scoped admin should never
// have to pick.
async function resolveTerritory(
  provided?: string | null
): Promise<{ territoryId: string; error: null } | { territoryId: null; error: string }> {
  const profile = await requireAdmin()
  if (provided) {
    if (!adminCanTerritory(profile, provided)) {
      return { territoryId: null, error: 'That market is outside your access.' }
    }
    return { territoryId: provided, error: null }
  }
  if (profile.territory_id) return { territoryId: profile.territory_id, error: null }

  const ctx = await getTerritoryContext(profile)
  if (ctx.activeId) return { territoryId: ctx.activeId, error: null }
  if (ctx.territories.length === 1) return { territoryId: ctx.territories[0].id, error: null }
  return {
    territoryId: null,
    error: 'Pick a market first — use the territory switcher in the sidebar.',
  }
}

interface OpportunityRow {
  id: string
  territory_id: string
  kind: OpportunityKind
  stage: string
  status: string
  business_name: string
  monthly_cents: number | null
}

// Annotated as a discriminated union rather than inferred: without the explicit
// type TypeScript widens both branches into one object with every field
// optional, and `g.row` becomes possibly-undefined at every call site.
type Guard =
  | { ok: false; error: string }
  | {
      ok: true
      row: OpportunityRow
      admin: ReturnType<typeof createAdminClient>
      profile: Awaited<ReturnType<typeof requireAdmin>>
    }

// Read the row and prove the caller may touch it. Service-role writes bypass RLS,
// so territory scope has to be re-checked in app code (same pattern as
// money/actions.ts and advertisers/[id]/actions.ts).
async function guard(id: string): Promise<Guard> {
  const profile = await requireAdmin()
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('opportunities')
    .select('id, territory_id, kind, stage, status, business_name, monthly_cents')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    return { ok: false, error: isMissingTable(error) ? MIGRATION_HINT : error.message }
  }
  if (!data) return { ok: false, error: 'That opportunity no longer exists.' }

  const row = data as OpportunityRow
  if (!adminCanTerritory(profile, row.territory_id)) {
    return { ok: false, error: 'That opportunity is outside your access.' }
  }
  return { ok: true, row, admin, profile }
}

async function writeEvent(
  admin: ReturnType<typeof createAdminClient>,
  opportunityId: string,
  createdBy: string,
  kind: string,
  fields: { body?: string | null; fromStage?: string | null; toStage?: string | null } = {}
) {
  await admin.from('opportunity_events').insert({
    opportunity_id: opportunityId,
    kind,
    body: fields.body ?? null,
    from_stage: fields.fromStage ?? null,
    to_stage: fields.toStage ?? null,
    created_by: createdBy,
  })
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface NewOpportunityInput {
  kind: OpportunityKind
  businessName: string
  contactName?: string | null
  email?: string | null
  phone?: string | null
  website?: string | null
  city?: string | null
  address?: string | null
  categoryId?: string | null
  monthlyCents?: number
  screens?: number | null
  source?: string | null
  stage?: string | null
  nextStep?: string | null
  nextStepAt?: string | null
  territoryId?: string | null
}

export async function createOpportunity(
  input: NewOpportunityInput
): Promise<{ id?: string; error: string | null }> {
  const profile = await requireAdmin()
  const name = input.businessName?.trim()
  if (!name) return { error: 'A business name is required.' }

  const t = await resolveTerritory(input.territoryId)
  if (t.error) return { error: t.error }

  const kind: OpportunityKind = input.kind === 'host' ? 'host' : 'advertiser'
  const stage = input.stage && isValidStage(kind, input.stage) ? input.stage : firstStage(kind)

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('opportunities')
    .insert({
      territory_id: t.territoryId,
      kind,
      business_name: name,
      contact_name: input.contactName?.trim() || null,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      website: input.website?.trim() || null,
      city: input.city?.trim() || null,
      address: input.address?.trim() || null,
      category_id: input.categoryId || null,
      stage,
      monthly_cents: Math.max(0, Math.round(input.monthlyCents ?? 0)),
      screens: input.screens && input.screens > 0 ? Math.round(input.screens) : null,
      source: input.source || null,
      next_step: input.nextStep?.trim() || null,
      next_step_at: input.nextStepAt || null,
      owner_id: profile.id,
      created_by: profile.id,
      last_touch_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) return { error: isMissingTable(error) ? MIGRATION_HINT : error.message }

  await writeEvent(admin, data.id, profile.id, 'created', { toStage: stage })
  revalidate()
  return { id: data.id, error: null }
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export type OpportunityPatch = Partial<{
  businessName: string
  contactName: string | null
  email: string | null
  phone: string | null
  website: string | null
  city: string | null
  address: string | null
  categoryId: string | null
  monthlyCents: number
  screens: number | null
  source: string | null
}>

const COLUMN: Record<keyof OpportunityPatch, string> = {
  businessName: 'business_name',
  contactName: 'contact_name',
  email: 'email',
  phone: 'phone',
  website: 'website',
  city: 'city',
  address: 'address',
  categoryId: 'category_id',
  monthlyCents: 'monthly_cents',
  screens: 'screens',
  source: 'source',
}

export async function updateOpportunity(id: string, patch: OpportunityPatch): Promise<Result> {
  const g = await guard(id)
  if (!g.ok) return { error: g.error }

  const update: Record<string, unknown> = {}
  for (const [key, column] of Object.entries(COLUMN) as [keyof OpportunityPatch, string][]) {
    if (!(key in patch)) continue
    let value = patch[key] as unknown
    if (key === 'businessName') {
      const trimmed = String(value ?? '').trim()
      if (!trimmed) return { error: 'A business name is required.' }
      value = trimmed
    } else if (key === 'monthlyCents') {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0) return { error: 'Enter a monthly amount of $0 or more.' }
      value = Math.round(n)
    } else if (key === 'screens') {
      const n = Number(value)
      value = value == null || !Number.isFinite(n) || n <= 0 ? null : Math.round(n)
    } else if (typeof value === 'string') {
      value = value.trim() || null
    }
    update[column] = value
  }
  if (!Object.keys(update).length) return { error: null }

  const { error } = await g.admin.from('opportunities').update(update).eq('id', id)
  if (error) return { error: error.message }

  revalidate(id)
  return { error: null }
}

// ---------------------------------------------------------------------------
// Move a card
// ---------------------------------------------------------------------------

export async function moveStage(id: string, toStage: string): Promise<Result> {
  const g = await guard(id)
  if (!g.ok) return { error: g.error }
  const { row, admin, profile } = g

  if (!isValidStage(row.kind, toStage)) return { error: 'That is not a stage on this board.' }
  if (row.stage === toStage && row.status === 'open') return { error: null }

  const { error } = await admin
    .from('opportunities')
    .update({
      stage: toStage,
      // Dragging a closed card back onto the board reopens it — otherwise a
      // mis-click on Lost is unrecoverable without touching the database.
      status: 'open',
      won_at: null,
      lost_at: null,
      lost_reason: null,
      last_touch_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return { error: error.message }

  await writeEvent(admin, id, profile.id, 'stage', {
    fromStage: row.stage,
    toStage,
    body:
      row.status === 'open'
        ? null
        : `Reopened from ${row.status === 'won' ? 'won' : 'lost'} into ${stageLabel(row.kind, toStage)}`,
  })
  revalidate(id)
  return { error: null }
}

// ---------------------------------------------------------------------------
// Won / lost
// ---------------------------------------------------------------------------

// Winning a HOST creates the venue immediately, hidden from the map
// (status 'inactive'), so the next step is adding a screen rather than retyping
// the address. Winning an ADVERTISER does not auto-create anything — that path
// needs a creative and a price, which is what /admin/deals/new is for; the UI
// links straight there with this record's details prefilled.
export async function markWon(id: string): Promise<{ error: string | null; venueId?: string }> {
  const g = await guard(id)
  if (!g.ok) return { error: g.error }
  const { row, admin, profile } = g

  let venueId: string | undefined

  if (row.kind === 'host') {
    const { data: full } = await admin
      .from('opportunities')
      .select('business_name, address, city, category_id, contact_name, email, phone, venue_id')
      .eq('id', id)
      .maybeSingle()
    const o = full as {
      business_name: string
      address: string | null
      city: string | null
      category_id: string | null
      contact_name: string | null
      email: string | null
      phone: string | null
      venue_id: string | null
    } | null

    if (o && !o.venue_id) {
      const { data: venue, error: venueError } = await admin
        .from('venues')
        .insert({
          territory_id: row.territory_id,
          name: o.business_name,
          address: o.address,
          city: o.city,
          category_id: o.category_id,
          contact_name: o.contact_name,
          contact_email: o.email,
          contact_phone: o.phone,
          // Hidden until a screen is paired and it is genuinely live. Also avoids
          // minting the host comp promo code, which activation does.
          status: 'inactive',
        })
        .select('id')
        .single()
      if (venueError) return { error: `Marked won, but the venue could not be created: ${venueError.message}` }
      venueId = venue.id
    } else if (o?.venue_id) {
      venueId = o.venue_id
    }
  }

  const { error } = await admin
    .from('opportunities')
    .update({
      status: 'won',
      won_at: new Date().toISOString(),
      lost_at: null,
      lost_reason: null,
      next_step: null,
      next_step_at: null,
      last_touch_at: new Date().toISOString(),
      ...(venueId ? { venue_id: venueId } : {}),
    })
    .eq('id', id)
  if (error) return { error: error.message }

  await writeEvent(admin, id, profile.id, 'won', {
    fromStage: row.stage,
    body: venueId ? 'Venue created, hidden from the map until a screen is live.' : null,
  })
  revalidate(id)
  if (venueId) revalidatePath('/admin/venues')
  return { error: null, venueId }
}

export async function markLost(id: string, reason: string): Promise<Result> {
  const g = await guard(id)
  if (!g.ok) return { error: g.error }
  const { row, admin, profile } = g

  const trimmed = reason?.trim()
  // The reason is the whole point — a lost deal with no objection recorded
  // teaches nothing, and these are the objections the pitch has to answer.
  if (!trimmed) return { error: 'Say why it was lost — that is the part worth keeping.' }

  const { error } = await admin
    .from('opportunities')
    .update({
      status: 'lost',
      lost_at: new Date().toISOString(),
      lost_reason: trimmed,
      won_at: null,
      next_step: null,
      next_step_at: null,
      last_touch_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return { error: error.message }

  await writeEvent(admin, id, profile.id, 'lost', { fromStage: row.stage, body: trimmed })
  revalidate(id)
  return { error: null }
}

// ---------------------------------------------------------------------------
// Activity + follow-ups
// ---------------------------------------------------------------------------

export async function logActivity(
  id: string,
  kind: LoggableEventKind,
  body: string
): Promise<Result> {
  const g = await guard(id)
  if (!g.ok) return { error: g.error }

  const trimmed = body?.trim()
  if (!trimmed) return { error: 'Nothing to log.' }

  await writeEvent(g.admin, id, g.profile.id, kind, { body: trimmed })
  await g.admin
    .from('opportunities')
    .update({ last_touch_at: new Date().toISOString() })
    .eq('id', id)

  revalidate(id)
  return { error: null }
}

export async function setNextStep(
  id: string,
  step: string,
  at: string | null
): Promise<Result> {
  const g = await guard(id)
  if (!g.ok) return { error: g.error }

  const trimmed = step?.trim() || null
  // A date with no description is a reminder that says nothing when it fires.
  if (at && !trimmed) return { error: 'Say what the next step is, not just when.' }

  const { error } = await g.admin
    .from('opportunities')
    .update({ next_step: trimmed, next_step_at: trimmed ? at : null })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidate(id)
  return { error: null }
}

// Called by the New-deal form when it was opened from an opportunity. This is
// the join that stops the pipeline being a parallel universe: the card now points
// at the campaign it became, so the record page can link straight to the live
// account and reports can tell a won deal from a hopeful guess.
export async function attachDealToOpportunity(
  id: string,
  campaignId: string,
  advertiserId: string
): Promise<Result> {
  const g = await guard(id)
  if (!g.ok) return { error: g.error }

  const { error } = await g.admin
    .from('opportunities')
    .update({
      campaign_id: campaignId,
      advertiser_id: advertiserId,
      status: 'won',
      won_at: new Date().toISOString(),
      lost_at: null,
      lost_reason: null,
      next_step: null,
      next_step_at: null,
      last_touch_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return { error: error.message }

  await writeEvent(g.admin, id, g.profile.id, 'won', {
    fromStage: g.row.stage,
    body: 'Deal set up — campaign is live.',
  })
  revalidate(id)
  return { error: null }
}

export async function deleteOpportunity(id: string): Promise<Result> {
  const g = await guard(id)
  if (!g.ok) return { error: g.error }
  const { error } = await g.admin.from('opportunities').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidate()
  return { error: null }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportRow {
  businessName: string
  contactName?: string
  email?: string
  phone?: string
  city?: string
  website?: string
  monthlyCents?: number
}

export async function importOpportunities(
  kind: OpportunityKind,
  source: string | null,
  rows: ImportRow[]
): Promise<{ created: number; skipped: number; error: string | null }> {
  const profile = await requireAdmin()
  const t = await resolveTerritory(null)
  if (t.error) return { created: 0, skipped: 0, error: t.error }

  const clean = rows
    .map((r) => ({ ...r, businessName: r.businessName?.trim() ?? '' }))
    .filter((r) => r.businessName)
  if (!clean.length) return { created: 0, skipped: 0, error: 'No rows with a business name.' }
  if (clean.length > 500) {
    return { created: 0, skipped: 0, error: 'That is more than 500 rows — split it up.' }
  }

  const admin = createAdminClient()

  // Don't create a second card for a business already on the board. Matching on
  // lower(name) within the same market and kind is deliberately blunt; a near
  // duplicate is far less annoying than silently merging two real venues.
  const { data: existingData, error: existingError } = await admin
    .from('opportunities')
    .select('business_name')
    .eq('territory_id', t.territoryId)
    .eq('kind', kind)
  if (existingError) {
    return {
      created: 0,
      skipped: 0,
      error: isMissingTable(existingError) ? MIGRATION_HINT : existingError.message,
    }
  }
  const seen = new Set(
    ((existingData ?? []) as { business_name: string }[]).map((r) => r.business_name.toLowerCase())
  )

  const stage = firstStage(kind)
  const now = new Date().toISOString()
  const toInsert = clean
    .filter((r) => {
      const key = r.businessName.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((r) => ({
      territory_id: t.territoryId,
      kind,
      business_name: r.businessName,
      contact_name: r.contactName?.trim() || null,
      email: r.email?.trim() || null,
      phone: r.phone?.trim() || null,
      city: r.city?.trim() || null,
      website: r.website?.trim() || null,
      monthly_cents: Math.max(0, Math.round(r.monthlyCents ?? 0)),
      stage,
      source,
      owner_id: profile.id,
      created_by: profile.id,
      last_touch_at: now,
    }))

  const skipped = clean.length - toInsert.length
  if (!toInsert.length) {
    return { created: 0, skipped, error: null }
  }

  const { data, error } = await admin.from('opportunities').insert(toInsert).select('id')
  if (error) return { created: 0, skipped, error: error.message }

  const ids = (data ?? []) as { id: string }[]
  if (ids.length) {
    await admin.from('opportunity_events').insert(
      ids.map((r) => ({
        opportunity_id: r.id,
        kind: 'created',
        to_stage: stage,
        body: 'Imported',
        created_by: profile.id,
      }))
    )
  }

  revalidate()
  return { created: ids.length, skipped, error: null }
}

// The shape of the sales pipeline: stages, sources, and the pure helpers that
// read a row. No server imports — the board is a Client Component and needs all
// of this to render a card.
//
// Stages live here rather than in a table on purpose. They are a workflow
// opinion, not data: renaming a column is a code change reviewed once, whereas a
// stage-editor UI is a lot of surface for a decision made twice a year. The DB
// column is a plain `text` with no CHECK, so changing this list never needs a
// migration — see supabase/migrations/0068_opportunities.sql.

export type OpportunityKind = 'advertiser' | 'host'
export type OpportunityStatus = 'open' | 'won' | 'lost'

export interface StageDef {
  key: string
  label: string
  // What has to be true to sit here. Shown as the column's subtitle so the board
  // is self-explaining rather than depending on remembering what "Interested"
  // meant when you set it three weeks ago.
  meaning: string
}

// Advertisers: businesses that might buy slots. Short ladder on purpose — this
// is a $75/mo decision, not an enterprise sale, and a six-stage funnel for a
// one-call close just creates stages nothing ever sits in.
export const ADVERTISER_STAGES: StageDef[] = [
  { key: 'new', label: 'New', meaning: 'Identified, not contacted yet' },
  { key: 'contacted', label: 'Contacted', meaning: 'Reached out, no reply yet' },
  { key: 'interested', label: 'Interested', meaning: 'They replied and want to hear more' },
  { key: 'proposal', label: 'Proposal sent', meaning: 'Screens and price are on the table' },
]

// Hosts: venues that might take a screen. Longer, because there is a physical
// install between agreement and revenue, and a screen sitting in a box is a very
// different problem from a venue that has not signed.
export const HOST_STAGES: StageDef[] = [
  { key: 'identified', label: 'Identified', meaning: 'A venue worth having' },
  { key: 'pitched', label: 'Pitched', meaning: 'They have heard the offer' },
  { key: 'agreement', label: 'Agreement sent', meaning: 'Waiting on a signature' },
  { key: 'install', label: 'Install scheduled', meaning: 'Signed, screen not up yet' },
]

export function stagesFor(kind: OpportunityKind): StageDef[] {
  return kind === 'host' ? HOST_STAGES : ADVERTISER_STAGES
}

export function firstStage(kind: OpportunityKind): string {
  return stagesFor(kind)[0].key
}

export function stageLabel(kind: OpportunityKind, key: string): string {
  return stagesFor(kind).find((s) => s.key === key)?.label ?? key
}

export function isValidStage(kind: OpportunityKind, key: string): boolean {
  return stagesFor(kind).some((s) => s.key === key)
}

// What "won" is called depends on which side you are selling. A host does not
// get "Won", they go Live.
export function wonLabel(kind: OpportunityKind): string {
  return kind === 'host' ? 'Live' : 'Won'
}
export function lostLabel(kind: OpportunityKind): string {
  return kind === 'host' ? 'Passed' : 'Lost'
}

export const KIND_LABEL: Record<OpportunityKind, string> = {
  advertiser: 'Advertisers',
  host: 'Hosts',
}

// Where it came from. Fixed list rather than free text so attribution on the
// reports page is countable — a typo'd source is a source that disappears from
// the chart. Values are stable keys; only the labels are cosmetic.
export const SOURCES: { key: string; label: string }[] = [
  { key: 'brew_sponsor', label: 'Brew Loop sponsor' },
  { key: 'referral', label: 'Referral' },
  { key: 'walk_in', label: 'Walk-in / in person' },
  { key: 'cold_dm', label: 'Cold DM or email' },
  { key: 'cold_call', label: 'Cold call' },
  { key: 'inbound', label: 'They came to us' },
  { key: 'qr', label: 'QR / screen' },
  { key: 'event', label: 'Event' },
  { key: 'other', label: 'Other' },
]

export function sourceLabel(key: string | null): string {
  if (!key) return 'Unknown'
  return SOURCES.find((s) => s.key === key)?.label ?? key
}

export const EVENT_KINDS = ['note', 'call', 'email', 'meeting'] as const
export type LoggableEventKind = (typeof EVENT_KINDS)[number]
export type EventKind = LoggableEventKind | 'created' | 'stage' | 'won' | 'lost'

export const EVENT_LABEL: Record<EventKind, string> = {
  created: 'Added',
  note: 'Note',
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  stage: 'Moved',
  won: 'Won',
  lost: 'Lost',
}

export interface Opportunity {
  id: string
  territoryId: string
  kind: OpportunityKind
  businessName: string
  contactName: string | null
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  city: string | null
  categoryId: string | null
  categoryName: string | null
  stage: string
  status: OpportunityStatus
  monthlyCents: number
  screens: number | null
  source: string | null
  lostReason: string | null
  nextStep: string | null
  nextStepAt: string | null
  lastTouchAt: string | null
  advertiserId: string | null
  campaignId: string | null
  venueId: string | null
  createdAt: string
  wonAt: string | null
  lostAt: string | null
}

// The fields the record page lets you edit in place. Kept here (rather than
// imported from the server action file) so a Client Component can name a field
// without pulling 'use server' code into the browser bundle. Must stay in step
// with OpportunityPatch in app/(admin)/admin/pipeline/actions.ts.
export type OpportunityPatchField =
  | 'businessName'
  | 'contactName'
  | 'email'
  | 'phone'
  | 'website'
  | 'city'
  | 'address'
  | 'monthlyCents'
  | 'screens'

export interface OpportunityEvent {
  id: string
  kind: EventKind
  body: string | null
  fromStage: string | null
  toStage: string | null
  createdAt: string
  authorName: string | null
}

// ---------------------------------------------------------------------------
// Follow-up urgency. One implementation, used by the card, the record page, and
// the Today queue, so "overdue" can never mean two different things.
// ---------------------------------------------------------------------------

export type FollowUpState = 'none' | 'overdue' | 'today' | 'soon' | 'later'

export function followUpState(nextStepAt: string | null, nowMs = Date.now()): FollowUpState {
  if (!nextStepAt) return 'none'
  const due = new Date(nextStepAt).getTime()
  if (!Number.isFinite(due)) return 'none'
  const days = Math.floor((due - nowMs) / 86_400_000)
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days <= 3) return 'soon'
  return 'later'
}

// Only these two are work for today. Used by the Today queue so it stays a list
// of things that will not move unless Jacob moves them.
export function isDue(state: FollowUpState): boolean {
  return state === 'overdue' || state === 'today'
}

export const FOLLOW_UP_TONE: Record<FollowUpState, string> = {
  overdue: 'text-destructive',
  today: 'text-warning',
  soon: 'text-muted-foreground',
  later: 'text-muted-foreground',
  none: 'text-muted-foreground',
}

// A prospect nobody has touched in this many days is going cold. Surfaced on the
// card, not enforced anywhere.
export const STALE_DAYS = 14

export function daysSince(iso: string | null, nowMs = Date.now()): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return Math.floor((nowMs - t) / 86_400_000)
}

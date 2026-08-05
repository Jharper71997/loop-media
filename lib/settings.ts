// The editable-settings registry.
//
// Every business number the admin used to be unable to change without a code
// deploy is declared here once: its type, its label, the reason it exists, and
// the value that is in force today. Two things read this registry:
//
//   1. getSettings() (lib/settings.server.ts) overlays whatever is stored in the
//      app_settings table on top of these defaults.
//   2. /admin/settings generates its whole UI from it, so a new setting appears
//      on that page the moment it is added here — no page edit.
//
// DEFAULTS ARE LOAD-BEARING. If the app_settings table is missing or unreadable
// the app runs on exactly these numbers, which are the same ones that were
// hardcoded before. That is what makes this safe to ship ahead of the migration:
// nothing changes until a value is deliberately saved.
//
// This file is pure and client-safe — no server imports — so a Client Component
// can render a setting's label and bounds without dragging next/headers along.

export type SettingKind = 'cents' | 'int' | 'days' | 'percent' | 'text'

export interface SettingDef {
  label: string
  // Which card it lands in on /admin/settings.
  group: SettingGroup
  kind: SettingKind
  // The value in force today — the number that used to be hardcoded.
  default: number | string
  // Why this number exists, in a sentence. Shown under the field, and it is the
  // only record of decisions like "Susan call, 2026-06-14".
  help: string
  min?: number
  max?: number
  // Where changing it shows up, so you can tell the blast radius before saving.
  affects?: string
}

export type SettingGroup =
  | 'Goals'
  | 'Creative help'
  | 'Ad changes'
  | 'Memberships'
  | 'Creative limits'
  | 'Screens & uptime'
  | 'Reporting'

export const SETTING_GROUPS: SettingGroup[] = [
  'Goals',
  'Creative help',
  'Ad changes',
  'Memberships',
  'Creative limits',
  'Screens & uptime',
  'Reporting',
]

// Keep every default identical to the constant it replaces. A mismatch here is a
// silent repricing.
export const SETTINGS = {
  mrr_goal_cents: {
    label: 'MRR goal',
    group: 'Goals',
    kind: 'cents',
    default: 400_000,
    help: 'The recurring revenue you are driving at. Comps never count toward it.',
    min: 0,
    affects: 'Today, Sell, Money, Reports',
  },
  mrr_goal_label: {
    label: 'Goal deadline',
    group: 'Goals',
    kind: 'text',
    default: 'Dec 31, 2026',
    help: 'Shown next to the goal. Free text so it can read however you say it out loud.',
    affects: 'Today, Sell, Reports',
  },
  due_soon_days: {
    label: 'Due-soon window',
    group: 'Goals',
    kind: 'days',
    default: 10,
    help: 'How many days before an account lapses it starts showing up in the queue.',
    min: 1,
    max: 90,
    affects: "Today's queue, Money",
  },

  creative_setup_fee_cents: {
    label: 'Creative setup fee',
    group: 'Creative help',
    kind: 'cents',
    default: 9_900,
    help: 'One-time, charged on the first invoice. Only when they ask for creative help — uploading their own stays free.',
    min: 0,
    affects: 'Checkout, invoices',
  },
  creative_refresh_cents: {
    label: 'Creative refresh',
    group: 'Creative help',
    kind: 'cents',
    default: 2_000,
    help: 'Monthly, recurs alongside the plan.',
    min: 0,
    affects: 'Checkout, invoices',
  },

  ad_change_fee_cents: {
    label: 'Ad change fee',
    group: 'Ad changes',
    kind: 'cents',
    default: 1_000,
    help: 'Flat fee to swap the creative on a live campaign. Covers the manual approval that pushes to every screen. (Susan call, 2026-06-14.)',
    min: 0,
    affects: 'Advertiser portal',
  },
  ad_change_free_every_days: {
    label: 'Free change every',
    group: 'Ad changes',
    kind: 'days',
    default: 7,
    help: 'The first creative change inside this many days is free.',
    min: 0,
    max: 365,
    affects: 'Advertiser portal',
  },
  ad_change_notice_days: {
    label: 'Change notice',
    group: 'Ad changes',
    kind: 'days',
    default: 30,
    help: 'Notice you ask advertisers to give. Shown in the UI, not enforced.',
    min: 0,
    max: 365,
    affects: 'Advertiser portal',
  },

  unlimited_changes_cents: {
    label: 'Unlimited changes',
    group: 'Memberships',
    kind: 'cents',
    default: 2_900,
    help: 'Monthly membership that makes creative changes free. Priced inline, so this is the only place to change it.',
    min: 0,
    affects: 'Checkout, advertiser portal',
  },
  insights_cents: {
    label: 'Insights',
    group: 'Memberships',
    kind: 'cents',
    default: 2_900,
    help: 'Monthly membership that unlocks QR scan analytics. Scans themselves are always free; this sells the demographics.',
    min: 0,
    affects: 'Checkout, advertiser results',
  },

  max_spot_seconds: {
    label: 'Max spot length',
    group: 'Creative limits',
    kind: 'int',
    default: 15,
    help: 'Longest ad accepted, in seconds.',
    min: 1,
    max: 120,
    affects: 'Upload validation, /tv rotation',
  },
  max_creative_mb: {
    label: 'Max file size',
    group: 'Creative limits',
    kind: 'int',
    default: 50,
    help: 'Largest creative accepted, in MB. Raising it risks Fire Stick players stalling on download.',
    min: 1,
    max: 500,
    affects: 'Upload validation',
  },
  max_schedule_days: {
    label: 'Schedule horizon',
    group: 'Creative limits',
    kind: 'days',
    default: 400,
    help: 'How far ahead creative can be scheduled on the content calendar.',
    min: 1,
    max: 3_650,
    affects: 'Content calendar',
  },

  uptime_sla_pct: {
    label: 'Uptime target',
    group: 'Screens & uptime',
    kind: 'percent',
    default: 80,
    help: 'Share of business hours a screen should be checking in. Host-facing only — advertisers never see uptime.',
    min: 0,
    max: 100,
    affects: 'Uptime page, host reports',
  },
  uptime_window_days: {
    label: 'Uptime window',
    group: 'Screens & uptime',
    kind: 'days',
    default: 30,
    help: 'How many days back uptime is measured over.',
    min: 1,
    max: 365,
    affects: 'Uptime page',
  },
  nearby_radius_mi: {
    label: 'Nearby radius',
    group: 'Screens & uptime',
    kind: 'int',
    default: 25,
    help: 'Miles used when matching an advertiser to venues near them.',
    min: 1,
    max: 500,
    affects: 'Venue search, map',
  },

  perf_window_days: {
    label: 'Performance window',
    group: 'Reporting',
    kind: 'days',
    default: 30,
    help: 'Default lookback for the performance numbers on advertiser results.',
    min: 1,
    max: 365,
    affects: 'Advertiser results, monthly report',
  },
} as const satisfies Record<string, SettingDef>

export type SettingKey = keyof typeof SETTINGS

export type Settings = {
  [K in SettingKey]: (typeof SETTINGS)[K]['default'] extends string ? string : number
}

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[]

export const DEFAULT_SETTINGS = Object.fromEntries(
  SETTING_KEYS.map((k) => [k, SETTINGS[k].default])
) as Settings

// ---------------------------------------------------------------------------
// Parsing and formatting. One implementation, shared by the inline editor, the
// settings page, and the server action that writes the value — so a value that
// displays as "$99.00" round-trips to 9900 and back no matter where it is typed.
// ---------------------------------------------------------------------------

export function formatSetting(key: SettingKey, value: number | string): string {
  const def = SETTINGS[key] as SettingDef
  if (typeof value === 'string') return value
  switch (def.kind) {
    case 'cents':
      return `$${(value / 100).toLocaleString('en-US', {
        minimumFractionDigits: value % 100 === 0 ? 0 : 2,
        maximumFractionDigits: 2,
      })}`
    case 'percent':
      return `${value}%`
    case 'days':
      return `${value} day${value === 1 ? '' : 's'}`
    default:
      return String(value)
  }
}

// What goes INTO the input box when you click a value to edit it. Dollars for a
// cents field, because nobody wants to type 9900 to mean $99.
export function toInputValue(key: SettingKey, value: number | string): string {
  const def = SETTINGS[key] as SettingDef
  if (typeof value === 'string') return value
  if (def.kind === 'cents') return (value / 100).toFixed(value % 100 === 0 ? 0 : 2)
  return String(value)
}

export function inputSuffix(key: SettingKey): string | null {
  const def = SETTINGS[key] as SettingDef
  switch (def.kind) {
    case 'cents':
      return 'USD'
    case 'percent':
      return '%'
    case 'days':
      return 'days'
    default:
      return null
  }
}

export type ParseResult =
  | { ok: true; value: number | string }
  | { ok: false; error: string }

// Validated on the way in AND again in the server action — a client that skips
// this must not be able to store a negative fee.
export function parseSettingInput(key: SettingKey, raw: string): ParseResult {
  const def = SETTINGS[key] as SettingDef
  const trimmed = raw.trim()

  if (def.kind === 'text') {
    if (!trimmed) return { ok: false, error: 'Cannot be empty' }
    if (trimmed.length > 120) return { ok: false, error: 'Keep it under 120 characters' }
    return { ok: true, value: trimmed }
  }

  // Strip the decoration people paste in with a price: $1,234.00 -> 1234.00
  const cleaned = trimmed.replace(/[$,\s%]/g, '')
  if (!cleaned) return { ok: false, error: 'Enter a number' }
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return { ok: false, error: 'Not a number' }

  const value = def.kind === 'cents' ? Math.round(n * 100) : Math.round(n)
  // Bounds are declared in the units a person types, so compare in those units
  // for everything except cents, where min/max are stated in cents.
  const compare = def.kind === 'cents' ? value : n

  if (def.min != null && compare < def.min) {
    return { ok: false, error: `Must be at least ${def.kind === 'cents' ? `$${def.min / 100}` : def.min}` }
  }
  if (def.max != null && compare > def.max) {
    return { ok: false, error: `Must be at most ${def.kind === 'cents' ? `$${def.max / 100}` : def.max}` }
  }
  return { ok: true, value }
}

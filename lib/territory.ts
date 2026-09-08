import { cache } from 'react'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Profile, Territory } from '@/lib/db.types'

export const TERRITORY_COOKIE = 'lm_territory'

export interface TerritoryContext {
  territories: Territory[] // all (non-holding) markets — one per state — for the switcher
  activeId: string | null // null == "all territories"
  locked: boolean // true for city-scoped admins (cannot switch)
}

// The market list, once per request. Every admin page resolves territory context,
// and the layout resolves it again for the switcher, so this ran twice on every
// navigation for a list that changes about once a quarter. Keyed on nothing
// because it takes no arguments — cache() here is purely "ask the database once".
const loadTerritories = cache(async (): Promise<Territory[]> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('territories')
    .select('*')
    .eq('is_holding', false)
    .order('name')
  return (data ?? []) as Territory[]
})

// Resolves which territory an admin is currently looking at.
// - City admins (profile.territory_id set) are pinned to their territory.
// - Global admins (territory_id null) read a cookie; "all" -> null (no filter).
export async function getTerritoryContext(
  profile: Profile
): Promise<TerritoryContext> {
  const territories = await loadTerritories()

  if (profile.territory_id) {
    return { territories, activeId: profile.territory_id, locked: true }
  }

  const cookieStore = await cookies()
  const sel = cookieStore.get(TERRITORY_COOKIE)?.value || 'all'
  // Only honour a cookie that still names a real market. A market can go away —
  // the city-to-state merge in 0076 retired most of them — and a stale id silently
  // filters every admin page down to nothing, which reads as "all my data is gone"
  // rather than as a bad cookie. Unknown falls back to all markets.
  const known = sel !== 'all' && territories.some((t) => t.id === sel)
  return { territories, activeId: known ? sel : null, locked: false }
}

// Turn a display name into a URL/dedupe slug (lowercase, non-alnum → single dash).
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// US states, keyed by postal code: display name + the timezone most of the state
// keeps. A market is a STATE, so this is the whole vocabulary of markets — a host
// typing a city that's new to us joins their state's market instead of minting a
// market of one. (Some states straddle two zones; the state's dominant zone is what
// a market-level default should say. A venue's own open/close hours are what
// reporting actually buckets by, so this is a label, not a scheduling input.)
const US_STATES: Record<string, { name: string; timezone: string }> = {
  AL: { name: 'Alabama', timezone: 'America/Chicago' },
  AK: { name: 'Alaska', timezone: 'America/Anchorage' },
  AZ: { name: 'Arizona', timezone: 'America/Phoenix' },
  AR: { name: 'Arkansas', timezone: 'America/Chicago' },
  CA: { name: 'California', timezone: 'America/Los_Angeles' },
  CO: { name: 'Colorado', timezone: 'America/Denver' },
  CT: { name: 'Connecticut', timezone: 'America/New_York' },
  DE: { name: 'Delaware', timezone: 'America/New_York' },
  DC: { name: 'District of Columbia', timezone: 'America/New_York' },
  FL: { name: 'Florida', timezone: 'America/New_York' },
  GA: { name: 'Georgia', timezone: 'America/New_York' },
  HI: { name: 'Hawaii', timezone: 'Pacific/Honolulu' },
  ID: { name: 'Idaho', timezone: 'America/Boise' },
  IL: { name: 'Illinois', timezone: 'America/Chicago' },
  IN: { name: 'Indiana', timezone: 'America/Indiana/Indianapolis' },
  IA: { name: 'Iowa', timezone: 'America/Chicago' },
  KS: { name: 'Kansas', timezone: 'America/Chicago' },
  KY: { name: 'Kentucky', timezone: 'America/New_York' },
  LA: { name: 'Louisiana', timezone: 'America/Chicago' },
  ME: { name: 'Maine', timezone: 'America/New_York' },
  MD: { name: 'Maryland', timezone: 'America/New_York' },
  MA: { name: 'Massachusetts', timezone: 'America/New_York' },
  MI: { name: 'Michigan', timezone: 'America/Detroit' },
  MN: { name: 'Minnesota', timezone: 'America/Chicago' },
  MS: { name: 'Mississippi', timezone: 'America/Chicago' },
  MO: { name: 'Missouri', timezone: 'America/Chicago' },
  MT: { name: 'Montana', timezone: 'America/Denver' },
  NE: { name: 'Nebraska', timezone: 'America/Chicago' },
  NV: { name: 'Nevada', timezone: 'America/Los_Angeles' },
  NH: { name: 'New Hampshire', timezone: 'America/New_York' },
  NJ: { name: 'New Jersey', timezone: 'America/New_York' },
  NM: { name: 'New Mexico', timezone: 'America/Denver' },
  NY: { name: 'New York', timezone: 'America/New_York' },
  NC: { name: 'North Carolina', timezone: 'America/New_York' },
  ND: { name: 'North Dakota', timezone: 'America/Chicago' },
  OH: { name: 'Ohio', timezone: 'America/New_York' },
  OK: { name: 'Oklahoma', timezone: 'America/Chicago' },
  OR: { name: 'Oregon', timezone: 'America/Los_Angeles' },
  PA: { name: 'Pennsylvania', timezone: 'America/New_York' },
  RI: { name: 'Rhode Island', timezone: 'America/New_York' },
  SC: { name: 'South Carolina', timezone: 'America/New_York' },
  SD: { name: 'South Dakota', timezone: 'America/Chicago' },
  TN: { name: 'Tennessee', timezone: 'America/Chicago' },
  TX: { name: 'Texas', timezone: 'America/Chicago' },
  UT: { name: 'Utah', timezone: 'America/Denver' },
  VT: { name: 'Vermont', timezone: 'America/New_York' },
  VA: { name: 'Virginia', timezone: 'America/New_York' },
  WA: { name: 'Washington', timezone: 'America/Los_Angeles' },
  WV: { name: 'West Virginia', timezone: 'America/New_York' },
  WI: { name: 'Wisconsin', timezone: 'America/Chicago' },
  WY: { name: 'Wyoming', timezone: 'America/Denver' },
  PR: { name: 'Puerto Rico', timezone: 'America/Puerto_Rico' },
}

// Accepts what a host actually types in the State box — "nc", "NC", "north
// carolina", " North Carolina " — and returns the canonical market for it.
// Anything we don't recognise is passed through as typed rather than rejected, so
// an odd entry still lands in a market instead of blocking a registration.
export function resolveStateMarket(state: string): {
  name: string
  slug: string
  timezone: string | null
} {
  const raw = state.trim()
  for (const cand of stateCandidates(raw)) {
    const byCode = US_STATES[cand.toUpperCase()]
    if (byCode) return { name: byCode.name, slug: slugify(byCode.name), timezone: byCode.timezone }
    const byName = Object.values(US_STATES).find(
      (s) => s.name.toLowerCase() === cand.toLowerCase()
    )
    if (byName) return { name: byName.name, slug: slugify(byName.name), timezone: byName.timezone }
  }
  return { name: raw, slug: slugify(raw), timezone: null }
}

// What to try, in order, when reading a State box. A host who types their whole
// location — "Rockledge, FL" or "Cocoa FL" — matched nothing and fell through to
// the passthrough above, minting a market named after their town: the precise
// thing state markets exist to prevent (it happened on 2026-09-07). The state is
// what people write last in an address fragment, so fall back to the tail after a
// comma, then the last word. Whole-string first, so "West Virginia" resolves to
// West Virginia and never to Virginia on its last word.
function stateCandidates(raw: string): string[] {
  const out = [raw]
  const afterComma = raw.split(',').pop()?.trim()
  if (afterComma && afterComma !== raw) out.push(afterComma)
  const lastWord = raw.split(/[\s,]+/).filter(Boolean).pop()
  if (lastWord && lastWord !== raw) out.push(lastWord)
  return out
}

// A venue's "market" (territory) is its STATE, created on the fly the first time we
// take a screen there — so hosts are never limited to a pre-seeded list, and a new
// town doesn't spawn a market of one. (It used to be city + state, which turned
// every new host into a separate "market": Hubert, Swansboro and Jacksonville were
// three markets on one 20-mile stretch of NC coast, so per-market pricing, category
// caps and exclusivity all meant nothing.) Returns the territory id (or null on
// failure). Admin client because `territories` is admin-write under RLS.
export async function findOrCreateTerritory(
  admin: ReturnType<typeof createAdminClient>,
  state: string
): Promise<string | null> {
  const market = resolveStateMarket(state)
  if (!market.slug) return null
  const { data: existing } = await admin
    .from('territories')
    .select('id')
    .eq('slug', market.slug)
    .maybeSingle()
  if (existing) return existing.id
  const { data: created } = await admin
    .from('territories')
    .insert({
      name: market.name,
      slug: market.slug,
      is_holding: false,
      status: 'active',
      // Let the column default stand for a state we don't know rather than writing
      // a guess into it.
      ...(market.timezone ? { timezone: market.timezone } : {}),
    })
    .select('id')
    .maybeSingle()
  return created?.id ?? null
}

// What is standing inside a market. Deleting a territory has to be blocked while
// anything points at it — every one of these FKs is ON DELETE RESTRICT, so the
// database would refuse anyway, but a count the admin can read beforehand is a
// better answer than a constraint error after the click.
//
// `admins` is here for a different reason: profiles.territory_id is ON DELETE SET
// NULL, so deleting a market would silently PROMOTE a city admin pinned to it
// into a global admin (territory_id null is what "Holdings-level" means). That is
// a privilege change, so it blocks the delete too.
export interface TerritoryUsage {
  venues: number
  ads: number
  campaigns: number
  opportunities: number
  admins: number
  // Everything above added up: zero means the territory is safe to delete.
  total: number
}

export async function territoryUsage(ids: string[]): Promise<Map<string, TerritoryUsage>> {
  const out = new Map<string, TerritoryUsage>(
    ids.map((id) => [
      id,
      { venues: 0, ads: 0, campaigns: 0, opportunities: 0, admins: 0, total: 0 },
    ])
  )
  if (!ids.length) return out

  const supabase = await createClient()
  // One round trip per table rather than one per (table × territory): these are
  // small tables and the id column is all we read. A table that doesn't exist yet
  // (a migration not applied) errors out and simply counts zero — the delete
  // itself is still protected by the FK.
  const tally = async (table: string, key: keyof TerritoryUsage) => {
    const { data } = await supabase.from(table).select('territory_id').in('territory_id', ids)
    for (const row of (data ?? []) as { territory_id: string | null }[]) {
      const u = row.territory_id ? out.get(row.territory_id) : null
      if (!u) continue
      u[key] += 1
      u.total += 1
    }
  }

  await Promise.all([
    tally('venues', 'venues'),
    tally('ads', 'ads'),
    tally('campaigns', 'campaigns'),
    tally('opportunities', 'opportunities'),
    tally('profiles', 'admins'),
  ])
  return out
}

// The blockers, in words, for the admin who is about to be told no.
export function usageSummary(u: TerritoryUsage): string {
  const parts: string[] = []
  const add = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`)
  }
  add(u.venues, 'venue', 'venues')
  add(u.ads, 'ad', 'ads')
  add(u.campaigns, 'campaign', 'campaigns')
  add(u.opportunities, 'prospect', 'prospects')
  add(u.admins, 'pinned admin', 'pinned admins')
  return parts.join(', ')
}

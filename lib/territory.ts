import { cache } from 'react'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Profile, Territory } from '@/lib/db.types'

export const TERRITORY_COOKIE = 'lm_territory'

export interface TerritoryContext {
  territories: Territory[] // all (non-holding) cities, for the switcher
  activeId: string | null // null == "all territories"
  locked: boolean // true for city-scoped admins (cannot switch)
}

// The city list, once per request. Every admin page resolves territory context,
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
  return { territories, activeId: sel === 'all' ? null : sel, locked: false }
}

// Turn a display name into a URL/dedupe slug (lowercase, non-alnum → single dash).
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// A venue's "market" (territory) is derived from the city + state it's in, and
// created on the fly if that city is new — so hosts are never limited to a
// pre-seeded list. Used both when a host first registers a venue and when they
// later edit its city/state. Returns the territory id (or null on failure).
// Admin client because `territories` is admin-write under RLS.
export async function findOrCreateTerritory(
  admin: ReturnType<typeof createAdminClient>,
  city: string,
  state: string
): Promise<string | null> {
  const name = `${city.trim()}, ${state.trim().toUpperCase()}`
  const slug = slugify(name)
  const { data: existing } = await admin
    .from('territories')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()
  if (existing) return existing.id
  const { data: created } = await admin
    .from('territories')
    .insert({ name, slug, is_holding: false, status: 'active' })
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

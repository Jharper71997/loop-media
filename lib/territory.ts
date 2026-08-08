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

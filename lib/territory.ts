import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import type { Profile, Territory } from '@/lib/db.types'

export const TERRITORY_COOKIE = 'lm_territory'

export interface TerritoryContext {
  territories: Territory[] // all (non-holding) cities, for the switcher
  activeId: string | null // null == "all territories"
  locked: boolean // true for city-scoped admins (cannot switch)
}

// Resolves which territory an admin is currently looking at.
// - City admins (profile.territory_id set) are pinned to their territory.
// - Global admins (territory_id null) read a cookie; "all" -> null (no filter).
export async function getTerritoryContext(
  profile: Profile
): Promise<TerritoryContext> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('territories')
    .select('*')
    .eq('is_holding', false)
    .order('name')
  const territories = (data ?? []) as Territory[]

  if (profile.territory_id) {
    return { territories, activeId: profile.territory_id, locked: true }
  }

  const cookieStore = await cookies()
  const sel = cookieStore.get(TERRITORY_COOKIE)?.value || 'all'
  return { territories, activeId: sel === 'all' ? null : sel, locked: false }
}

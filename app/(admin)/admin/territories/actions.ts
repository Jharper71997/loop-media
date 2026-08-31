'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, isGlobalAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { slugify, territoryUsage, usageSummary } from '@/lib/territory'

// Markets are Holdings-level: a city admin runs the market they are pinned to,
// they do not get to invent or remove one. RLS says the same thing
// (territories_admin_write is is_global_admin()), so this is the readable half of
// a rule the database also enforces.
async function requireGlobalAdmin() {
  const profile = await requireAdmin()
  return isGlobalAdmin(profile) ? null : 'Only a global admin can change markets.'
}

// Every surface that lists markets is behind the admin layout, and the territory
// switcher lives in that layout — so a new or deleted market has to invalidate the
// layout, not just this page, or the switcher keeps the old list.
function revalidateMarkets() {
  revalidatePath('/admin', 'layout')
}

// Create a market.
//
// The name shape matters: hosts registering a venue create markets on the fly
// through findOrCreateTerritory(), which builds "City, ST" and slugifies it. A
// market typed here has to land on the SAME slug or the next host in that city
// silently creates a duplicate alongside it. That is why this takes a city and a
// state rather than free text.
export async function createTerritory(input: {
  city: string
  state: string
  timezone: string
}) {
  const denied = await requireGlobalAdmin()
  if (denied) return { error: denied }

  const city = input.city.trim()
  const state = input.state.trim().toUpperCase()
  if (!city) return { error: 'City is required.' }
  if (!/^[A-Z]{2}$/.test(state)) return { error: 'State has to be the two-letter code, e.g. NC.' }

  const name = `${city}, ${state}`
  const slug = slugify(name)
  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('territories')
    .select('id, name')
    .eq('slug', slug)
    .maybeSingle()
  if (existing) return { error: `${(existing as { name: string }).name} already exists.` }

  const { error } = await supabase.from('territories').insert({
    name,
    slug,
    is_holding: false,
    status: 'active',
    timezone: input.timezone,
  })
  if (error) return { error: error.message }

  revalidateMarkets()
  return { error: null }
}

// Archive / restore. An archived market keeps every venue, ad and number it ever
// had — it just stops being offered to anyone new: it drops out of the advertiser
// browse and no enquiry from the public site lands in it. This is the answer for a
// market you have stopped selling, which is most of what "delete an old one" means.
export async function setTerritoryStatus(id: string, status: 'active' | 'inactive') {
  const denied = await requireGlobalAdmin()
  if (denied) return { error: denied }

  const supabase = await createClient()
  const { error } = await supabase.from('territories').update({ status }).eq('id', id)
  if (error) return { error: error.message }

  revalidateMarkets()
  return { error: null }
}

// Delete a market for good. Only ever possible while nothing points at it, which
// in practice means a market typed in by mistake or one a host created from a
// venue that was then removed.
export async function deleteTerritory(id: string) {
  const denied = await requireGlobalAdmin()
  if (denied) return { error: denied }

  const supabase = await createClient()
  const { data } = await supabase
    .from('territories')
    .select('id, name, is_holding')
    .eq('id', id)
    .maybeSingle()
  const territory = data as { id: string; name: string; is_holding: boolean } | null
  if (!territory) return { error: 'That market no longer exists.' }
  if (territory.is_holding) return { error: 'Holdings is the parent company, not a market.' }

  const usage = (await territoryUsage([id])).get(id)
  if (usage && usage.total > 0) {
    return {
      error: `${territory.name} still has ${usageSummary(usage)}. Move or remove those first, or archive the market instead.`,
    }
  }

  const { error } = await supabase.from('territories').delete().eq('id', id)
  // 23503 = foreign key violation: something points at this market that the
  // counts above don't cover (a table added since). Say so plainly rather than
  // showing the raw constraint name.
  if (error) {
    return {
      error:
        error.code === '23503'
          ? `${territory.name} is still in use elsewhere in the app. Archive it instead.`
          : error.message,
    }
  }

  revalidateMarkets()
  return { error: null }
}

import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/lib/db.types'

// Current signed-in profile (or null). Safe to call in Server Components.
//
// cache()d for the request, and that is not a micro-optimisation. `auth.getUser()`
// is a full HTTPS round trip to Supabase's auth service — it does not read the
// JWT locally, it asks GoTrue to validate it — and every admin page called this
// TWICE per navigation: once in the layout to gate the area, once in the page to
// scope the queries. With middleware's own refresh that made three auth round
// trips plus two identical profile selects before a single row of the page's own
// data was requested. Now the first caller pays, the rest are free.
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
  return (data as Profile) ?? null
})

export async function requireProfile(): Promise<Profile> {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  return profile
}

// Gate an admin-only area. Non-admins are bounced to their own home.
export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile()
  if (profile.role !== 'admin') redirect('/')
  return profile
}

// A global (Holdings) admin has no territory_id — they manage the whole network.
// City-scoped admins are pinned to a single territory.
export function isGlobalAdmin(profile: Profile): boolean {
  return profile.role === 'admin' && !profile.territory_id
}

// Can this admin act on a resource that lives in `territoryId`?
//   - Global admins: anywhere.
//   - City admins: only their own territory.
// A null resource-territory (a global/network-wide resource) is only actionable
// by a global admin. Used to add an explicit territory check to admin server
// actions that touch tables via the service-role client (which BYPASSES the RLS
// territory backstop) or whose RLS is plain is_admin() with no territory scope.
export function adminCanTerritory(profile: Profile, territoryId: string | null): boolean {
  if (isGlobalAdmin(profile)) return true
  return !!territoryId && profile.territory_id === territoryId
}

// Where a signed-in user should land based on role.
export function homeForRole(role: Profile['role']): string {
  switch (role) {
    case 'admin':
      return '/admin'
    case 'host':
      return '/host'
    default:
      return '/advertiser'
  }
}

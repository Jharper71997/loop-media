import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/lib/db.types'

// Current signed-in profile (or null). Safe to call in Server Components.
export async function getProfile(): Promise<Profile | null> {
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
}

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

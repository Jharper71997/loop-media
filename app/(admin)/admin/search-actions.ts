'use server'

import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export type AdminSearchHit = {
  type: 'Venue' | 'Advertiser' | 'Screen'
  id: string
  label: string
  sub: string | null
  href: string
}

// Backs the admin ⌘K palette: jump to any venue, advertiser, or screen by name
// (venue name for a screen). RLS scopes what a city admin can see.
export async function adminSearch(query: string): Promise<AdminSearchHit[]> {
  await requireAdmin()
  const q = query.trim()
  if (q.length < 2) return []
  const supabase = await createClient()
  const like = `%${q}%`

  const [venuesRes, advertisersRes, screensRes] = await Promise.all([
    supabase.from('venues').select('id, name, city, state').ilike('name', like).order('name').limit(6),
    supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('role', 'advertiser')
      .or(`full_name.ilike.${like},email.ilike.${like}`)
      .limit(6),
    supabase
      .from('tvs')
      .select('id, venue:venues!inner(name)')
      .ilike('venue.name', like)
      .limit(6),
  ])

  const hits: AdminSearchHit[] = []
  for (const v of (venuesRes.data ?? []) as { id: string; name: string; city: string | null; state: string | null }[]) {
    hits.push({
      type: 'Venue',
      id: v.id,
      label: v.name,
      sub: [v.city, v.state].filter(Boolean).join(', ') || null,
      href: `/admin/venues/${v.id}`,
    })
  }
  for (const a of (advertisersRes.data ?? []) as { id: string; full_name: string | null; email: string }[]) {
    hits.push({
      type: 'Advertiser',
      id: a.id,
      label: a.full_name ?? a.email,
      sub: a.full_name ? a.email : null,
      href: `/admin/advertisers/${a.id}`,
    })
  }
  for (const s of (screensRes.data ?? []) as { id: string; venue: { name: string } | { name: string }[] | null }[]) {
    const venue = Array.isArray(s.venue) ? s.venue[0] : s.venue
    hits.push({
      type: 'Screen',
      id: s.id,
      label: `Screen · ${venue?.name ?? 'Unknown venue'}`,
      sub: null,
      href: `/admin/tvs/${s.id}`,
    })
  }
  return hits
}

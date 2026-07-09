import { redirect } from 'next/navigation'
import { requireProfile, homeForRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveOwnScreenPromos } from '@/lib/ownPromo'
import type { Tv, Venue } from '@/lib/db.types'
import { OwnPromoForm, type PromoVenue, type ExistingPromo } from './OwnPromoForm'

export default async function PromotePage() {
  const profile = await requireProfile()
  if (!['host', 'admin'].includes(profile.role)) {
    redirect(homeForRole(profile.role))
  }
  const supabase = await createClient()

  const { data: venuesData } = await supabase
    .from('venues')
    .select('id, name, status, tvs(id)')
    .eq('host_user_id', profile.id)
    .order('name')
  type Row = Pick<Venue, 'id' | 'name' | 'status'> & { tvs: Pick<Tv, 'id'>[] }
  const venues = (venuesData ?? []) as unknown as Row[]
  const venueName = new Map(venues.map((v) => [v.id, v.name]))

  // The host's live own-screen promos (one per screen max).
  const admin = createAdminClient()
  const promos = await getActiveOwnScreenPromos(
    admin,
    profile.id,
    venues.map((v) => v.id)
  )
  const existing: ExistingPromo[] = promos.map((p) => ({
    campaignId: p.campaignId,
    title: p.title,
    venueName: venueName.get(p.venueId) ?? 'Your screen',
  }))
  const withPromo = new Set(promos.map((p) => p.venueId))

  // Can add a promo where the venue is live, has a screen, and isn't already taken.
  const available: PromoVenue[] = venues
    .filter((v) => v.status === 'active' && v.tvs.length > 0 && !withPromo.has(v.id))
    .map((v) => ({ id: v.id, name: v.name }))

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Your promo on your screen</h1>
        <p className="text-sm text-muted-foreground">
          Put your own image or video on your TV, free. It plays in the loop within about 30 seconds
          and stays until you remove it. One promo per screen at a time.
        </p>
      </div>

      <OwnPromoForm userId={profile.id} venues={available} existing={existing} />
    </div>
  )
}

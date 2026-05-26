import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { Ad, Venue } from '@/lib/db.types'
import { PromoSlots } from './PromoSlots'

const PROMO_SLOTS = 3

export default async function HostPromosPage() {
  const profile = await requireProfile()
  const supabase = await createClient()

  const { data: venuesData } = await supabase
    .from('venues')
    .select('id, name')
    .eq('host_user_id', profile.id)
    .order('name')
  const venues = (venuesData ?? []) as Pick<Venue, 'id' | 'name'>[]

  const { data: promosData } = await supabase
    .from('ads')
    .select('id, title, status, creative_type, creative_url, host_venue_id, created_at')
    .eq('owner_user_id', profile.id)
    .eq('owner_kind', 'host')
    .neq('status', 'rejected')
    .order('created_at', { ascending: true })
  const promos = (promosData ?? []) as Pick<
    Ad,
    'id' | 'title' | 'status' | 'creative_type' | 'creative_url' | 'host_venue_id' | 'created_at'
  >[]

  return (
    <div className="space-y-6">
      <Link
        href="/host"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Overview
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your promo slots</h1>
        <p className="text-sm text-muted-foreground">
          Run up to {PROMO_SLOTS} of your own 15-second promos on your screens, free. New promos
          go to Loop Media for a quick review before they go live.
        </p>
      </div>

      <PromoSlots
        userId={profile.id}
        venues={venues}
        promos={promos}
        maxSlots={PROMO_SLOTS}
      />
    </div>
  )
}

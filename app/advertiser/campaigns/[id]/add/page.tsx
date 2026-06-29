import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { isVenueListable } from '@/lib/venue'
import { AddScreensClient } from './AddScreensClient'

// Pick more venues to add to an existing active campaign. Scoped to the
// campaign's market (the placement engine only fills that territory) and hides
// venues already on the campaign or blocked by the ad's category exclusivity.
export default async function AddScreensPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await requireProfile()
  const supabase = await createClient()

  const { data: camp } = await supabase
    .from('campaigns')
    .select('id, advertiser_id, status, territory_id, ad:ads(category_id)')
    .eq('id', id)
    .maybeSingle()
  if (!camp || camp.advertiser_id !== profile.id) notFound()
  if (camp.status !== 'active') redirect(`/advertiser/campaigns/${id}`)

  const ad = Array.isArray(camp.ad) ? camp.ad[0] : camp.ad
  const adCategory = (ad?.category_id as string | null) ?? null

  const { data: existing } = await supabase
    .from('campaign_targets')
    .select('venue_id')
    .eq('campaign_id', id)
  const existingSet = new Set((existing ?? []).map((t) => t.venue_id as string))

  const { data: vRows } = await supabase
    .from('venues')
    .select('id, name, city, state, lat, lng, category_id, host_user_id')
    .eq('territory_id', camp.territory_id as string)
    .eq('status', 'active')
    .order('name')
  type VR = {
    id: string
    name: string
    city: string | null
    state: string | null
    lat: number | null
    lng: number | null
    category_id: string | null
    host_user_id: string | null
  }
  const available = ((vRows ?? []) as VR[])
    .filter((v) => isVenueListable(v))
    .filter((v) => !existingSet.has(v.id))
    .filter((v) => !(adCategory && v.category_id === adCategory && v.host_user_id !== profile.id))
    .map((v) => ({ id: v.id, name: v.name, city: v.city, state: v.state }))

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href={`/advertiser/campaigns/${id}`}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Back to campaign"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="font-heading text-xl font-bold tracking-tight">Add screens</h1>
          <p className="text-sm text-muted-foreground">
            More venues for this campaign. Your subscription updates automatically.
          </p>
        </div>
      </div>
      <AddScreensClient campaignId={id} venues={available} />
    </div>
  )
}

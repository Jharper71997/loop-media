import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { PromoSlots } from './PromoSlots'

const PROMO_SLOTS = 2

export default async function HostPromosPage() {
  const profile = await requireProfile()
  const supabase = await createClient()

  // The host's own venues anchor their market + business category. Promos run on
  // OTHER venues, so own venues are excluded from the picker.
  const { data: ownData } = await supabase
    .from('venues')
    .select('id, territory_id, category_id')
    .eq('host_user_id', profile.id)
  const own = ownData ?? []
  const territoryId = own.find((v) => v.territory_id)?.territory_id ?? null
  const hostCategory = own.find((v) => v.category_id)?.category_id ?? null
  const ownedIds = new Set(own.map((v) => v.id))

  // Eligible screens to run on: active + on the map, in the host's market, not
  // their own, and not a same-category competitor (exclusivity).
  let venues: { id: string; name: string }[] = []
  if (territoryId) {
    const { data: vData } = await supabase
      .from('venues')
      .select('id, name, category_id, status, lat, lng')
      .eq('territory_id', territoryId)
      .eq('status', 'active')
      .order('name')
    venues = (vData ?? [])
      .filter(
        (v) =>
          !ownedIds.has(v.id) &&
          v.lat != null &&
          v.lng != null &&
          (!hostCategory || v.category_id !== hostCategory)
      )
      .map((v) => ({ id: v.id, name: v.name }))
  }

  // Existing promos + the venue each one runs on (resolved via its campaign target).
  const { data: promosData } = await supabase
    .from('ads')
    .select('id, title, status, creative_type, creative_url, created_at')
    .eq('owner_user_id', profile.id)
    .eq('owner_kind', 'host')
    .neq('status', 'rejected')
    .order('created_at', { ascending: true })
  const promoRows = promosData ?? []

  const targetByAd = new Map<string, string>()
  if (promoRows.length) {
    const { data: camps } = await supabase
      .from('campaigns')
      .select('id, ad_id')
      .in('ad_id', promoRows.map((p) => p.id))
      .eq('advertiser_id', profile.id)
    const campToAd = new Map((camps ?? []).map((c) => [c.id, c.ad_id as string]))
    if (campToAd.size) {
      const { data: targets } = await supabase
        .from('campaign_targets')
        .select('campaign_id, venue_id')
        .in('campaign_id', [...campToAd.keys()])
      const rows = targets ?? []
      const { data: tVenues } = await supabase
        .from('venues')
        .select('id, name')
        .in('id', rows.map((r) => r.venue_id))
      const nameById = new Map((tVenues ?? []).map((v) => [v.id, v.name]))
      for (const r of rows) {
        const adId = campToAd.get(r.campaign_id as string)
        const name = nameById.get(r.venue_id as string)
        if (adId && name) targetByAd.set(adId, name)
      }
    }
  }

  const promos = promoRows.map((p) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    creative_type: p.creative_type,
    creative_url: p.creative_url,
    target_venue_name: targetByAd.get(p.id) ?? null,
  }))

  return (
    <div className="space-y-6">
      <Link
        href="/host"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Overview
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your free promos</h1>
        <p className="text-sm text-muted-foreground">
          Run up to {PROMO_SLOTS} of your own 15-second promos on other Loop Network screens around
          town, free. New promos go to Loop Network for a quick review before they go live.
        </p>
      </div>

      {own.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Set up your own screen first. Once your venue is live you get {PROMO_SLOTS} free promos
            to run across the network.
          </CardContent>
        </Card>
      ) : (
        <PromoSlots userId={profile.id} venues={venues} promos={promos} maxSlots={PROMO_SLOTS} />
      )}
    </div>
  )
}

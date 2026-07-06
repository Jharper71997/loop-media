import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { isTvLive } from '@/lib/format'
import { Card, CardContent } from '@/components/ui/card'
import { PromoSlots } from './PromoSlots'
import type { PromoVenue } from './PromoMapPicker'

const PROMO_SLOTS = 2

export default async function HostPromosPage() {
  const profile = await requireProfile()
  const supabase = await createClient()

  // The host's own venues anchor their market + business category. Promos run on
  // OTHER venues, so own venues are excluded from the picker.
  const { data: ownData } = await supabase
    .from('venues')
    .select('id, territory_id, category_id, lat, lng')
    .eq('host_user_id', profile.id)
  const own = ownData ?? []
  const territoryId = own.find((v) => v.territory_id)?.territory_id ?? null
  const hostCategory = own.find((v) => v.category_id)?.category_id ?? null
  const ownedIds = new Set(own.map((v) => v.id))
  // Center the picker map on the host's own venue so nearby screens read at a glance.
  const homeVenue = own.find((v) => v.lat != null && v.lng != null)
  const homeLoc: [number, number] | null = homeVenue
    ? [homeVenue.lat as number, homeVenue.lng as number]
    : null

  // Eligible screens to run on: active + on the map, in the host's market, not
  // their own, and not a same-category competitor (host protection). Each carries
  // live availability (open slots / coming soon) so the picker map can show the
  // host what's actually open and where.
  let venues: PromoVenue[] = []
  if (territoryId) {
    const { data: vData } = await supabase
      .from('venues')
      .select(
        'id, name, category_id, status, lat, lng, tvs(id, last_heartbeat_at, loop_length_seconds, slot_seconds)'
      )
      .eq('territory_id', territoryId)
      .eq('status', 'active')
      .order('name')

    type Row = {
      id: string
      name: string
      category_id: string | null
      status: string
      lat: number | null
      lng: number | null
      tvs: {
        id: string
        last_heartbeat_at: string | null
        loop_length_seconds: number
        slot_seconds: number
      }[]
    }
    const rows = (vData ?? []) as unknown as Row[]

    const eligible = rows.filter(
      (v) =>
        !ownedIds.has(v.id) &&
        v.lat != null &&
        v.lng != null &&
        (!hostCategory || v.category_id !== hostCategory)
    )

    // One pass over active placements → slot usage per TV, so we can surface how
    // many open slots each screen has (same idea as the paid browse map).
    const tvIds = eligible.flatMap((r) => r.tvs.map((t) => t.id))
    const usedByTv = new Map<string, number>()
    if (tvIds.length) {
      const { data: placements } = await supabase
        .from('ad_placements')
        .select('tv_id')
        .in('tv_id', tvIds)
        .eq('status', 'active')
      for (const p of placements ?? []) {
        usedByTv.set(p.tv_id, (usedByTv.get(p.tv_id) ?? 0) + 1)
      }
    }

    venues = eligible.map((r) => {
      const capacity = r.tvs.reduce(
        (sum, t) =>
          sum + Math.max(1, Math.floor((t.loop_length_seconds || 360) / (t.slot_seconds || 15))),
        0
      )
      const used = r.tvs.reduce((sum, t) => sum + (usedByTv.get(t.id) ?? 0), 0)
      const open = Math.max(capacity - used, 0)
      // Coming soon = no screen has checked in recently (the TV isn't online yet).
      const comingSoon = !r.tvs.some((t) => isTvLive(t.last_heartbeat_at))
      return { id: r.id, name: r.name, lat: r.lat, lng: r.lng, open, comingSoon }
    })
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
        <PromoSlots
          userId={profile.id}
          venues={venues}
          promos={promos}
          maxSlots={PROMO_SLOTS}
          homeLoc={homeLoc}
        />
      )}
    </div>
  )
}

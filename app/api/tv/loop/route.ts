import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Returns the ordered ad loop for a paired device, plus venue info the display
// uses for filler (weather etc). Only approved/active ads with a creative play.
export async function GET(req: Request) {
  const device = new URL(req.url).searchParams.get('device')
  if (!device) {
    return NextResponse.json({ error: 'Missing device.' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data: tvRow } = await supabase
    .from('tvs')
    .select('id, loop_length_seconds, slot_seconds, venue:venues(name, lat, lng, territory:territories(name))')
    .eq('device_id', device)
    .maybeSingle()

  if (!tvRow) {
    return NextResponse.json({ error: 'Device not paired.' }, { status: 404 })
  }

  const tv = tvRow as unknown as {
    id: string
    loop_length_seconds: number
    slot_seconds: number
    venue: {
      name: string
      lat: number | null
      lng: number | null
      territory: { name: string } | null
    } | null
  }

  const now = new Date().toISOString()
  await supabase.from('tvs').update({ status: 'online', last_sync_at: now }).eq('id', tv.id)

  const { data: placements } = await supabase
    .from('ad_placements')
    .select(
      'slot_position, ad:ads(id, title, creative_type, creative_url, duration_seconds, qr_target_url, status)'
    )
    .eq('tv_id', tv.id)
    .eq('status', 'active')
    .order('slot_position')

  type PlacementRow = {
    slot_position: number
    ad: {
      id: string
      title: string
      creative_type: 'video' | 'image'
      creative_url: string | null
      duration_seconds: number
      qr_target_url: string | null
      status: string
    } | null
  }

  const items = ((placements ?? []) as unknown as PlacementRow[])
    .filter(
      (p) =>
        p.ad &&
        p.ad.creative_url &&
        ['approved', 'active'].includes(p.ad.status)
    )
    .map((p) => ({
      type: 'ad' as const,
      id: p.ad!.id,
      title: p.ad!.title,
      creative_type: p.ad!.creative_type,
      creative_url: p.ad!.creative_url as string,
      duration: p.ad!.duration_seconds || tv.slot_seconds,
      qr: p.ad!.qr_target_url,
    }))

  return NextResponse.json({
    tv: { loop_length_seconds: tv.loop_length_seconds, slot_seconds: tv.slot_seconds },
    venue: tv.venue,
    items,
    generated_at: now,
  })
}

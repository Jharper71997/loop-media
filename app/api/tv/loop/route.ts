import { NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { createAdminClient } from '@/lib/supabase/admin'

// Public base URL the phone-scannable QR must point at (the deployed domain in
// prod; localhost in dev). Prefers explicit env, then forwarded host headers.
function baseUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL
  if (env) return env.replace(/\/$/, '')
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  return host ? `${proto}://${host}` : new URL(req.url).origin
}

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

  const base = baseUrl(req)
  const playable = ((placements ?? []) as unknown as PlacementRow[]).filter(
    (p) => p.ad && p.ad.creative_url && ['approved', 'active'].includes(p.ad.status)
  )

  const items = await Promise.all(
    playable.map(async (p) => {
      const ad = p.ad!
      // QR encodes the tracked redirect (/r/<ad>?t=<tv>) so each scan is logged
      // and attributed to this screen. Inline data URL so it caches offline.
      let qr_image: string | null = null
      if (ad.qr_target_url) {
        const scanUrl = `${base}/r/${ad.id}?t=${tv.id}`
        qr_image = await QRCode.toDataURL(scanUrl, {
          margin: 1,
          width: 240,
          color: { dark: '#000000', light: '#ffffff' },
        })
      }
      return {
        type: 'ad' as const,
        id: ad.id,
        title: ad.title,
        creative_type: ad.creative_type,
        creative_url: ad.creative_url as string,
        duration: ad.duration_seconds || tv.slot_seconds,
        qr: ad.qr_target_url,
        qr_image,
      }
    })
  )

  return NextResponse.json({
    tv: { loop_length_seconds: tv.loop_length_seconds, slot_seconds: tv.slot_seconds },
    venue: tv.venue,
    items,
    generated_at: now,
  })
}

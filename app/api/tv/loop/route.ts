import { NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { createAdminClient } from '@/lib/supabase/admin'
import { genPairingCode, deviceSecretOk } from '@/lib/tv'
import { QR_SIZE_DEFAULT } from '@/lib/adCreative'

// Public base URL the phone-scannable QR must point at (the deployed domain in
// prod; localhost in dev). Prefers explicit env, then forwarded host headers.
function baseUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL
  if (env) return env.replace(/\/$/, '')
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  return host ? `${proto}://${host}` : new URL(req.url).origin
}

// The Jville Brew Loop house-ad destination shown on every screen: the QR opens
// the Brew Loop site (jvillebrewloop.com), where a rider books. The $5 off is the
// Stripe promotion code LOOP5 (live in the Brew Loop Stripe account), entered at
// checkout. Override via env if the destination changes.
const BREWLOOP_OFFER_URL =
  process.env.NEXT_PUBLIC_BREWLOOP_OFFER_URL || 'https://jvillebrewloop.com'

// The Loop Network "advertise on this screen" house-slide QR points at the
// marketing site (not the in-app signup flow) — a business owner scans it to
// learn about Loop Network. Override via env if the domain changes.
const LOOP_SITE_URL = process.env.NEXT_PUBLIC_LOOP_SITE_URL || 'https://loopnetwork.org'

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
    .select('id, device_secret, loop_length_seconds, slot_seconds, brewloop_seconds, advertise_seconds, trivia_slide_seconds, filler_seconds, overscan_pct, venue:venues(id, name, lat, lng, play_code, trivia_enabled, territory:territories(id, name))')
    .eq('device_id', device)
    .maybeSingle()

  if (!tvRow) {
    return NextResponse.json({ error: 'Device not paired.' }, { status: 404 })
  }

  const tv = tvRow as unknown as {
    id: string
    device_secret: string | null
    loop_length_seconds: number
    slot_seconds: number
    brewloop_seconds: number | null
    advertise_seconds: number | null
    trivia_slide_seconds: number | null
    filler_seconds: number | null
    overscan_pct: number | null
    venue: {
      id: string
      name: string
      lat: number | null
      lng: number | null
      play_code: string | null
      trivia_enabled: boolean | null
      territory: { id: string; name: string } | null
    } | null
  }

  // A device WITH a secret must present it (x-device-secret header or ?secret=).
  // Legacy null-secret screens are grandfathered (deviceSecretOk). Blocks a leaked
  // device_id from pulling the loop as a spoofed screen.
  if (!deviceSecretOk(tv.device_secret, req)) {
    return NextResponse.json({ error: 'Device secret mismatch.' }, { status: 403 })
  }

  const now = new Date().toISOString()
  await supabase.from('tvs').update({ status: 'online', last_sync_at: now }).eq('id', tv.id)

  const { data: placements } = await supabase
    .from('ad_placements')
    .select(
      'slot_position, ad:ads(id, title, creative_type, creative_url, duration_seconds, qr_target_url, qr_x, qr_y, qr_size, status)'
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
      qr_x: number | null
      qr_y: number | null
      qr_size: number | null
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
        qr_x: ad.qr_x ?? 0.9,
        qr_y: ad.qr_y ?? 0.88,
        qr_size: ad.qr_size ?? QR_SIZE_DEFAULT,
      }
    })
  )

  // Custom filler cards (trivia / local events / sports / promos) the admin
  // authored for this territory. Active and unexpired only. The TV interleaves
  // them with ads + the built-in weather/clock slides.
  let filler: { type: string; payload: Record<string, unknown> }[] = []
  const territoryId = tv.venue?.territory?.id
  if (territoryId) {
    const { data: fillerData } = await supabase
      .from('filler_content')
      .select('type, payload, expires_at')
      .eq('territory_id', territoryId)
      .eq('active', true)
      .order('created_at', { ascending: false })
    filler = ((fillerData ?? []) as { type: string; payload: Record<string, unknown>; expires_at: string | null }[])
      .filter((f) => !f.expires_at || new Date(f.expires_at).getTime() > Date.now())
      .map((f) => ({ type: f.type, payload: f.payload }))
  }

  // A TRIVIA-ENABLED venue needs a play_code so the phone-trivia join link works
  // and the TV shows the trivia slide. Mint one lazily the first time trivia is
  // turned on here (idempotent: only sets when still null, then reads back the
  // live value so a concurrent request's code wins cleanly). Trivia-off venues
  // get no code and no trivia slide.
  if (tv.venue?.trivia_enabled && !tv.venue.play_code) {
    await supabase
      .from('venues')
      .update({ play_code: genPairingCode() })
      .eq('id', tv.venue.id)
      .is('play_code', null)
    const { data: vp } = await supabase
      .from('venues')
      .select('play_code')
      .eq('id', tv.venue.id)
      .maybeSingle()
    tv.venue.play_code = vp?.play_code ?? null
  }

  // Trivia join QR for the on-screen "play trivia" slide — only where trivia is on.
  let trivia: { code: string; url: string; qr_image: string } | null = null
  if (tv.venue?.trivia_enabled && tv.venue?.play_code) {
    const playUrl = `${base}/play/${tv.venue.play_code}`
    trivia = {
      code: tv.venue.play_code,
      url: playUrl,
      qr_image: await QRCode.toDataURL(playUrl, {
        margin: 1,
        width: 240,
        color: { dark: '#000000', light: '#ffffff' },
      }),
    }
  }

  // Scan QR for the house / "advertise on this screen" slide: a business owner who
  // sees it scans to reach the Loop Network site and learn more. Points at the
  // marketing site (not the in-app signup flow). Always present (unlike ads/trivia).
  const advertise = {
    url: LOOP_SITE_URL,
    qr_image: await QRCode.toDataURL(LOOP_SITE_URL, {
      margin: 1,
      width: 240,
      color: { dark: '#000000', light: '#ffffff' },
    }),
  }

  // Jville Brew Loop house ad ($5 off, scan to book) — plays on every screen.
  const brewloop = {
    url: BREWLOOP_OFFER_URL,
    qr_image: await QRCode.toDataURL(BREWLOOP_OFFER_URL, {
      margin: 1,
      width: 240,
      color: { dark: '#000000', light: '#ffffff' },
    }),
  }

  return NextResponse.json({
    tv: {
      loop_length_seconds: tv.loop_length_seconds,
      slot_seconds: tv.slot_seconds,
      brewloop_seconds: tv.brewloop_seconds,
      advertise_seconds: tv.advertise_seconds,
      trivia_slide_seconds: tv.trivia_slide_seconds,
      filler_seconds: tv.filler_seconds,
      overscan_pct: tv.overscan_pct,
    },
    venue: tv.venue,
    items,
    filler,
    trivia,
    advertise,
    brewloop,
    generated_at: now,
    // Deployment id so the long-running TV page can detect a new release and
    // reload itself (a screen otherwise runs the JS it booted with forever).
    build:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.VERCEL_DEPLOYMENT_ID ??
      'dev',
  })
}

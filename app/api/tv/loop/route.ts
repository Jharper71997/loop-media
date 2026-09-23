import { NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { createAdminClient } from '@/lib/supabase/admin'
import { genPairingCode, deviceSecretOk } from '@/lib/tv'
import { HOUSE_SELECT, resolveHouse, type HouseRow } from '@/lib/houseSlides'
import { QR_SIZE_DEFAULT } from '@/lib/adCreative'
import { NETWORK_TZ, windowForDay, type PerDayHours } from '@/lib/openHours'

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
// The only market the Brew Loop slide may ever play in (see below).
const BREWLOOP_MARKET = 'North Carolina'

// The Loop Network "advertise on this screen" house-slide QR points at the
// marketing site (not the in-app signup flow) — a business owner scans it to
// learn about Loop Network. Override via env if the domain changes.
const LOOP_SITE_URL = process.env.NEXT_PUBLIC_LOOP_SITE_URL || 'https://loopnetwork.org'

// Fold an uploaded override into the house-slide payload. Absent (the normal
// case) this adds nothing at all, so the manifest keeps the exact shape older
// cached players already understand and they go on drawing the built-in design.
function creativeFields(c: HouseRow | null) {
  if (!c || c.mode !== 'creative' || !c.creative_url) return {}
  return {
    creative_type: c.creative_type,
    creative_url: c.creative_url,
  }
}

// Returns the ordered ad loop for a paired device, plus venue info the display
// uses for the house slides. Only approved/active ads with a creative play.
export async function GET(req: Request) {
  const device = new URL(req.url).searchParams.get('device')
  if (!device) {
    return NextResponse.json({ error: 'Missing device.' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data: tvRow, error: tvErr } = await supabase
    .from('tvs')
    .select('id, device_secret, loop_length_seconds, slot_seconds, brewloop_seconds, advertise_seconds, trivia_slide_seconds, overscan_pct, sleep_when_closed, venue:venues(id, name, lat, lng, play_code, trivia_enabled, business_open, business_close, business_days, business_hours, territory:territories(id, name))')
    .eq('device_id', device)
    .maybeSingle()

  // "The database did not answer" is NOT "this device does not exist". The error
  // used to be dropped on the floor here, so any Supabase hiccup answered 404 —
  // and 404 is the one reply that makes a screen erase its own identity and drop
  // to the pairing screen for good. On 2026-08-14 a single bad response took five
  // venues dark inside 20 seconds. A screen must retry a failure, never obey it.
  if (tvErr) {
    return NextResponse.json({ error: 'Lookup failed.' }, { status: 503 })
  }
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
    overscan_pct: number | null
    sleep_when_closed: boolean | null
    venue: {
      id: string
      name: string
      lat: number | null
      lng: number | null
      play_code: string | null
      trivia_enabled: boolean | null
      business_open: string | null
      business_close: string | null
      business_days: number[] | null
      business_hours: PerDayHours | null
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

  // Remote commands an admin queued for this screen (migration 0078). This poll
  // is the only inbound channel a screen has — a venue router NATs it and nothing
  // can dial in — so a button in the admin becomes an action here, up to ~30s
  // later. Marked delivered as they go out; the player acks separately via
  // /api/tv/command so "sent" and "done" stay different facts. Capped so a queue
  // that somehow ran away can't hand a screen a hundred things to do at once.
  //
  // The admin "Watch screen" preview polls this same endpoint from a browser tab
  // and must never DEQUEUE: a peek at a screen would otherwise swallow the command
  // meant for the TV, mark it delivered, and leave an admin watching a preview
  // that obeys while the real screen never hears a thing.
  const isPreview = new URL(req.url).searchParams.get('preview') === '1'
  const commands: { id: string; command: string }[] = []
  if (!isPreview) {
    const { data: queued } = await supabase
      .from('tv_commands')
      .select('id, command')
      .eq('tv_id', tv.id)
      .is('delivered_at', null)
      .order('created_at')
      .limit(5)
    for (const c of (queued ?? []) as { id: string; command: string }[]) {
      commands.push({ id: c.id, command: c.command })
    }
    if (commands.length) {
      await supabase
        .from('tv_commands')
        .update({ delivered_at: now })
        .in('id', commands.map((c) => c.id))
    }
  }

  // The venue's open hours, restated as a plain 7-day table the screen can act on
  // by itself. The native shell arms an exact alarm from this and sleeps/wakes the
  // panel on the edges, so an overnight network outage can't leave a screen lit
  // all night (or, worse, asleep all day). Only sent when the screen has opted in;
  // otherwise the shell is handed nothing and behaves exactly as it does today.
  const power = tv.sleep_when_closed
    ? {
        sleep_when_closed: true,
        tz: NETWORK_TZ,
        // Keys '0'..'6', 0=Sunday. A missing day means closed all day, which the
        // shell reads as "stay asleep" rather than "stay awake".
        windows: Object.fromEntries(
          [0, 1, 2, 3, 4, 5, 6]
            .map((d) => [d, tv.venue ? windowForDay(tv.venue, d) : null] as const)
            .filter(([, w]) => w !== null)
        ) as Record<string, { open: string; close: string }>,
      }
    : { sleep_when_closed: false, tz: NETWORK_TZ, windows: {} }

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

  // What this screen's market has said about the two house slides (0063 + 0075):
  // an uploaded replacement, the built-in design, or off entirely. The whole
  // table is a handful of rows, so it's read in one go and resolved in lib —
  // the same resolution the admin page and the slot math use.
  const { data: houseData } = await supabase
    .from('house_creatives')
    .select(HOUSE_SELECT)
    .eq('active', true)
  const houseRows = (houseData ?? []) as HouseRow[]
  const marketId = tv.venue?.territory?.id ?? null
  const advertiseRow = resolveHouse(houseRows, 'advertise', marketId)
  const brewloopRow = resolveHouse(houseRows, 'brewloop', marketId)

  // Scan QR for the house / "advertise on this screen" slide: a business owner who
  // sees it scans to reach the Loop Network site and learn more. Points at the
  // marketing site (not the in-app signup flow). NULL when this market has the
  // slide switched off — the player leaves it out of the loop rather than
  // rendering an empty one.
  const advertise =
    advertiseRow?.mode === 'off'
      ? null
      : {
          url: LOOP_SITE_URL,
          qr_image: await QRCode.toDataURL(LOOP_SITE_URL, {
            margin: 1,
            width: 240,
            color: { dark: '#000000', light: '#ffffff' },
          }),
          ...creativeFields(advertiseRow),
        }

  // Jville Brew Loop house ad ($5 off, scan to book) — NORTH CAROLINA ONLY. A
  // Jacksonville shuttle means nothing to a room in Florida or Indiana, so this is
  // a hard rule here rather than a setting: no house_creatives row, network-wide
  // default or newly created market can put it on a screen outside NC. Inside NC a
  // market row can still take it off.
  const brewloop =
    tv.venue?.territory?.name !== BREWLOOP_MARKET || brewloopRow?.mode === 'off'
      ? null
      : {
          url: BREWLOOP_OFFER_URL,
          qr_image: await QRCode.toDataURL(BREWLOOP_OFFER_URL, {
            margin: 1,
            width: 240,
            color: { dark: '#000000', light: '#ffffff' },
          }),
          ...creativeFields(brewloopRow),
        }

  return NextResponse.json({
    tv: {
      loop_length_seconds: tv.loop_length_seconds,
      slot_seconds: tv.slot_seconds,
      brewloop_seconds: tv.brewloop_seconds,
      advertise_seconds: tv.advertise_seconds,
      trivia_slide_seconds: tv.trivia_slide_seconds,
      overscan_pct: tv.overscan_pct,
    },
    venue: tv.venue,
    items,
    trivia,
    advertise,
    brewloop,
    power,
    commands,
    generated_at: now,
    // Deployment id so the long-running TV page can detect a new release and
    // reload itself (a screen otherwise runs the JS it booted with forever).
    build:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.VERCEL_DEPLOYMENT_ID ??
      'dev',
  })
}

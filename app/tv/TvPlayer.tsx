'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'

const GOLD = '#d4af37'
const DEVICE_KEY = 'lm_device'
const cacheKey = (d: string) => `lm_loop_${d}`

type AdItem = {
  type: 'ad'
  id: string
  title: string
  creative_type: 'video' | 'image'
  creative_url: string
  duration: number
  qr: string | null
  qr_image: string | null
}

type FillerCard = {
  type: 'weather' | 'sports' | 'trivia' | 'event' | 'promo'
  payload: { headline?: string; sub?: string; foot?: string }
}

type Manifest = {
  tv: { loop_length_seconds: number; slot_seconds: number }
  venue: { id: string; name: string; lat: number | null; lng: number | null; territory: { name: string } | null } | null
  items: AdItem[]
  filler?: FillerCard[]
  trivia?: { code: string; url: string; qr_image: string } | null
  generated_at: string
  build?: string
}

type Slide =
  | (AdItem & { kind: 'ad' })
  | { kind: 'weather' }
  | { kind: 'clock' }
  | { kind: 'trivia' }
  | { kind: 'promo' }
  | { kind: 'filler'; card: FillerCard }

const FILLER_SECONDS = 10

// WMO weather code -> label + emoji (Open-Meteo).
function weatherInfo(code: number): { label: string; emoji: string } {
  if (code === 0) return { label: 'Clear', emoji: '☀️' }
  if (code <= 3) return { label: 'Partly cloudy', emoji: '⛅' }
  if (code <= 48) return { label: 'Fog', emoji: '🌫️' }
  if (code <= 67) return { label: 'Rain', emoji: '🌧️' }
  if (code <= 77) return { label: 'Snow', emoji: '❄️' }
  if (code <= 82) return { label: 'Showers', emoji: '🌦️' }
  return { label: 'Storms', emoji: '⛈️' }
}

function buildPlaylist(m: Manifest): Slide[] {
  const slot = m.tv.slot_seconds || 15
  const cards = m.filler ?? []
  // Filler pool rotated between ads (and used to fill empty screens): the live
  // trivia teaser, weather, then any authored cards.
  const fillerPool: Slide[] = []
  if (m.trivia) fillerPool.push({ kind: 'trivia' })
  fillerPool.push({ kind: 'weather' })
  for (const card of cards) fillerPool.push({ kind: 'filler', card })
  let fi = 0
  const nextFiller = (): Slide => fillerPool[fi++ % fillerPool.length]

  if (!m.items.length) {
    // No ads sold yet: lead with the Loop Network house ad, then rotate the
    // filler pool (trivia, weather, authored cards). No bare clock/date screen.
    return [{ kind: 'promo' }, ...fillerPool]
  }
  const out: Slide[] = []
  m.items.forEach((it) => {
    out.push({ ...it, kind: 'ad', duration: it.duration || slot })
    // Drop a filler card after EVERY ad (cycling trivia → weather → authored
    // cards). The old "every 3rd ad" meant a screen with 1-2 ads showed no
    // trivia at all; alternating keeps the trivia teaser on screen regularly.
    out.push(nextFiller())
  })
  out.push({ kind: 'promo' })
  return out
}

// Badge label for an authored filler card.
function fillerLabel(type: FillerCard['type']): string {
  if (type === 'trivia') return 'Trivia'
  if (type === 'event') return "What's on"
  if (type === 'sports') return 'Game day'
  if (type === 'promo') return 'Featured'
  return ''
}

export function TvPlayer() {
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  // Admin "Watch screen" preview (/tv?device=<id>&preview=1): render the exact
  // live loop but stay non-intrusive — don't claim this browser as the device
  // (no localStorage), don't heartbeat, don't log plays. So an admin can peek at
  // any screen without faking it live or inflating proof-of-play.
  const [preview, setPreview] = useState(false)

  useEffect(() => {
    // A provisioned screen carries its identity in the kiosk URL
    // (/tv?device=<uuid>) because we program the Pi before shipping it. Read it
    // first so the screen runs as a known device with zero pairing, then persist
    // it so it survives later boots even if the URL is ever plain /tv. Falls back
    // to a previously stored id, then to the manual/?code= pairing path.
    const params = new URLSearchParams(window.location.search)
    const isPreview = params.get('preview') === '1'
    setPreview(isPreview)
    const urlDevice = params.get('device')?.trim()
    // In preview never read/persist the stored device — keep the admin's browser
    // from inheriting (or becoming) a real screen.
    const id = urlDevice || (isPreview ? null : localStorage.getItem(DEVICE_KEY))
    if (id) {
      if (!isPreview) localStorage.setItem(DEVICE_KEY, id)
      setDeviceId(id)
    }
    setReady(true)
    // Cache creative media for offline playback (skip in preview).
    if (!isPreview && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/tv-sw.js').catch(() => {})
    }
  }, [])

  if (!ready) return <Splash>Starting…</Splash>
  if (!deviceId)
    return (
      <Pairing
        onPaired={(id) => {
          localStorage.setItem(DEVICE_KEY, id)
          setDeviceId(id)
        }}
      />
    )
  return (
    <Player
      deviceId={deviceId}
      preview={preview}
      onUnpair={() => {
        localStorage.removeItem(DEVICE_KEY)
        setDeviceId(null)
      }}
    />
  )
}

/* ---------------- Pairing ---------------- */

function Pairing({ onPaired }: { onPaired: (deviceId: string) => void }) {
  // A screen can carry its pairing code in the kiosk URL (/tv?code=XXXX) so it
  // pairs itself on first boot with no human input. Read it synchronously so we
  // show a quiet "pairing…" state — not the manual form — while the auto-pair
  // runs. After success the device_id lives in localStorage and the screen skips
  // pairing on later boots; the code stays reusable so it can be re-added anytime.
  const presetCode =
    typeof window === 'undefined'
      ? ''
      : (new URLSearchParams(window.location.search).get('code') ?? '').trim().toUpperCase()

  const [code, setCode] = useState(presetCode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoPairing, setAutoPairing] = useState(!!presetCode)
  const attempted = useRef(false)

  const pair = useCallback(
    async (pairingCode: string) => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch('/api/tv/pair', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pairing_code: pairingCode }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Pairing failed')
        onPaired(data.device_id)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Pairing failed')
        setBusy(false)
        // Auto-pair failed (e.g. bad code or no network): reveal the manual form
        // so it can still be paired by hand.
        setAutoPairing(false)
      }
    },
    [onPaired]
  )

  // Fire the preset auto-pair exactly once, on first boot.
  useEffect(() => {
    if (attempted.current || !presetCode) return
    attempted.current = true
    pair(presetCode)
  }, [presetCode, pair])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    await pair(code)
  }

  // Quiet status while a provisioned screen pairs itself (no keyboard involved).
  if (autoPairing) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-black text-white">
        <Image
          src="/loop-network-logo.png"
          alt="Loop Network"
          width={220}
          height={220}
          priority
          className="mb-4 h-40 w-auto"
        />
        <p className="text-white/50">Pairing this screen…</p>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-black text-white">
      <Image
        src="/loop-network-logo.png"
        alt="Loop Network"
        width={220}
        height={220}
        priority
        className="mb-4 h-40 w-auto"
      />
      <p className="mb-8 text-white/50">Pair this screen</p>
      <form onSubmit={submit} className="flex flex-col items-center gap-4">
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="XXXX"
          maxLength={4}
          className="w-80 rounded-xl border border-white/15 bg-white/5 px-6 py-5 text-center text-3xl tracking-widest uppercase outline-none focus:border-[#d4af37]"
        />
        <button
          type="submit"
          disabled={busy || !code}
          style={{ background: GOLD }}
          className="rounded-xl px-8 py-3 text-lg font-medium text-black disabled:opacity-50"
        >
          {busy ? 'Pairing…' : 'Pair screen'}
        </button>
        {error && <p className="text-red-400">{error}</p>}
      </form>
      <p className="mt-10 max-w-md text-center text-sm text-white/40">
        Enter the pairing code from your Loop Network dashboard. It&apos;s shown under your venue,
        next to this screen.
      </p>
    </div>
  )
}

/* ---------------- Player ---------------- */

function Player({
  deviceId,
  preview = false,
  onUnpair,
}: {
  deviceId: string
  preview?: boolean
  onUnpair: () => void
}) {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [index, setIndex] = useState(0)
  const [stale, setStale] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [weather, setWeather] = useState<{ temp: number; code: number } | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const motionRef = useRef<HTMLDivElement | null>(null)
  // The build this page booted with. When a later poll reports a different
  // build, a new version has deployed and we reload — otherwise the screen runs
  // the JS it started with forever and never picks up fixes.
  const bootBuild = useRef<string | null>(null)
  // The screen-label + Unpair controls stay hidden during playback (a TV has no
  // mouse hover) so the display is clean. A tap/remote-click reveals them for a
  // few seconds — long enough to unpair or go fullscreen — then they hide again.
  const [controlsShown, setControlsShown] = useState(false)
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const revealControls = useCallback(() => {
    setControlsShown(true)
    if (controlsTimer.current) clearTimeout(controlsTimer.current)
    controlsTimer.current = setTimeout(() => setControlsShown(false), 5000)
  }, [])

  // Fullscreen so the screen looks like a real display, not a browser tab.
  // Browsers require a user gesture, so we go fullscreen on the first tap/click
  // anywhere (and expose a button). No-ops on TV browsers that lack the API.
  const goFullscreen = useCallback(() => {
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>
    }
    const req = el.requestFullscreen ?? el.webkitRequestFullscreen
    if (req) req.call(el).catch(() => {})
  }, [])
  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const loadLoop = useCallback(async () => {
    try {
      const res = await fetch(`/api/tv/loop?device=${encodeURIComponent(deviceId)}`, {
        cache: 'no-store',
      })
      if (res.status === 404) {
        onUnpair()
        return
      }
      if (!res.ok) throw new Error('fetch failed')
      const data: Manifest = await res.json()
      // Self-update: reload once when the deployed build changes (skip in the
      // admin preview, which isn't a real screen). First successful load just
      // records the build.
      if (!preview && data.build) {
        if (bootBuild.current === null) {
          bootBuild.current = data.build
        } else if (bootBuild.current !== data.build) {
          window.location.reload()
          return
        }
      }
      setManifest(data)
      setStale(false)
      localStorage.setItem(cacheKey(deviceId), JSON.stringify(data))
    } catch {
      // Offline: fall back to the cached loop so playback continues.
      const cached = localStorage.getItem(cacheKey(deviceId))
      if (cached) {
        setManifest(JSON.parse(cached))
        setStale(true)
      } else {
        setFatal('No connection and nothing cached yet.')
      }
    }
  }, [deviceId, onUnpair, preview])

  // Initial load + periodic resync (30s) so a newly approved ad shows up on the
  // screen within ~30s without anyone touching the TV. Also re-sync whenever
  // the tab regains focus/visibility (e.g. someone wakes the screen).
  useEffect(() => {
    loadLoop()
    const id = setInterval(loadLoop, 30 * 1000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadLoop()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', loadLoop)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', loadLoop)
    }
  }, [loadLoop])

  // Keep the screen awake. Best-effort: stops the browser/device from dimming
  // or sleeping where the Wake Lock API is supported, and re-acquires the lock
  // when the tab becomes visible again (the OS drops it on blur). This does NOT
  // override a TV's built-in screensaver / ambient mode / auto power-off, which
  // must be turned off in the TV's own settings.
  useEffect(() => {
    type WakeLockSentinel = { release: () => Promise<void> }
    type WakeLockNav = { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinel> } }
    const wl = (navigator as Navigator & WakeLockNav).wakeLock
    if (!wl) return
    let sentinel: WakeLockSentinel | null = null
    let released = false
    const acquire = async () => {
      try {
        sentinel = await wl.request('screen')
      } catch {
        /* not granted (e.g. tab not visible) */
      }
    }
    acquire()
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !released) acquire()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVisible)
      sentinel?.release().catch(() => {})
    }
  }, [])

  // Anti-sleep: a near-invisible element nudged forever via the Web Animations
  // API. Many TVs (and Fire Stick screensavers) dim or sleep when the frame is
  // STATIC for a while — e.g. a single image ad. Continuous sub-pixel motion
  // keeps the frame "changing" so that detection doesn't trip. Runs on the
  // compositor (not throttled like rAF). This is a best-effort MITIGATION; the
  // reliable fix is disabling the TV/stick screensaver in its own settings at
  // install. Complements the Wake Lock above.
  useEffect(() => {
    const el = motionRef.current
    if (!el || typeof el.animate !== 'function') return
    const anim = el.animate(
      [{ transform: 'translateX(0px)' }, { transform: 'translateX(6px)' }],
      { duration: 4000, iterations: Infinity, direction: 'alternate' }
    )
    return () => anim.cancel()
  }, [])

  // Heartbeat (30s). Skipped in admin preview so a peek doesn't fake the screen
  // as live (the "live now" signal is the heartbeat, not the loop fetch).
  // Only beats while the page is VISIBLE: when the stick sleeps or backgrounds
  // (e.g. the TV is powered off and HDMI-CEC puts the Fire Stick to standby),
  // beats stop and the admin app shows the screen offline within ~95s instead of
  // reporting a dark TV as live. Resumes immediately on wake.
  useEffect(() => {
    if (preview) return
    const beat = () => {
      if (document.visibilityState !== 'visible') return
      fetch('/api/tv/heartbeat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId }),
        keepalive: true,
      }).catch(() => {})
    }
    beat()
    const id = setInterval(beat, 30 * 1000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') beat()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [deviceId, preview])

  // Clock tick.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Weather (refresh every 15 min) using the venue's coordinates.
  useEffect(() => {
    const lat = manifest?.venue?.lat
    const lng = manifest?.venue?.lng
    if (lat == null || lng == null) return
    const fetchWeather = async () => {
      try {
        const r = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`
        )
        const d = await r.json()
        setWeather({ temp: Math.round(d.current.temperature_2m), code: d.current.weather_code })
      } catch {
        /* keep last */
      }
    }
    fetchWeather()
    const id = setInterval(fetchWeather, 15 * 60 * 1000)
    return () => clearInterval(id)
  }, [manifest?.venue?.lat, manifest?.venue?.lng])

  // Memoized so the playlist (and the current `slide`) keep a stable reference
  // between renders. Without this, the 1s clock tick rebuilt `slide` every
  // second, which reset the advance timer below before it could fire — freezing
  // the loop on the first ad and hiding every later slot.
  const playlist = useMemo(() => (manifest ? buildPlaylist(manifest) : []), [manifest])
  const slide = playlist.length ? playlist[index % playlist.length] : null

  // How long this slide holds. Videos run to their own `ended` event; everything
  // else (images, filler, promo) uses the admin-set seconds.
  const isVideoAd = slide?.kind === 'ad' && slide.creative_type === 'video'
  const slideSeconds = slide ? (slide.kind === 'ad' ? slide.duration : FILLER_SECONDS) : 0

  // Advance the loop on a timer keyed to PRIMITIVES (index, length, this slide's
  // duration/kind) — never the rebuilt `slide` object — so unrelated re-renders
  // (the per-second clock) can't keep resetting it.
  useEffect(() => {
    if (!slide || isVideoAd) return
    timer.current = setTimeout(
      () => setIndex((i) => (i + 1) % Math.max(playlist.length, 1)),
      slideSeconds * 1000
    )
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, playlist.length, slideSeconds, isVideoAd])

  // Proof of play: log each time an ad slide becomes active. Skipped in admin
  // preview so peeking doesn't inflate a screen's play counts.
  useEffect(() => {
    if (preview) return
    if (!slide || slide.kind !== 'ad') return
    fetch('/api/tv/play', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, ad_id: slide.id }),
      keepalive: true,
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, deviceId])

  const advance = () => setIndex((i) => (i + 1) % Math.max(playlist.length, 1))

  if (fatal) return <Splash>{fatal}</Splash>
  if (!manifest || !slide) return <Splash>Loading loop…</Splash>

  const venueName = manifest.venue?.name ?? ''
  const w = weather ? weatherInfo(weather.code) : null

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-black text-white"
      onClick={() => {
        if (!document.fullscreenElement) goFullscreen()
        revealControls()
      }}
    >
      {slide.kind === 'ad' ? (
        slide.creative_type === 'video' ? (
          <video
            key={slide.id + index}
            src={slide.creative_url}
            className="h-full w-full object-contain"
            autoPlay
            muted
            playsInline
            onEnded={advance}
            onError={advance}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={slide.creative_url} alt={slide.title} className="h-full w-full object-contain" />
        )
      ) : slide.kind === 'weather' ? (
        <FillerFrame title="Loop Network">
          <div className="text-[12rem] leading-none">{w?.emoji ?? '🌡️'}</div>
          <div className="mt-4 text-7xl font-semibold">
            {weather ? `${weather.temp}°F` : '—'}
          </div>
          <div className="mt-2 text-3xl text-white/60">{w?.label ?? 'Weather'}</div>
        </FillerFrame>
      ) : slide.kind === 'trivia' ? (
        <TriviaSlide
          venueId={manifest.venue?.id ?? ''}
          code={manifest.trivia?.code ?? ''}
          qrImage={manifest.trivia?.qr_image ?? ''}
        />
      ) : slide.kind === 'clock' ? (
        <FillerFrame title="Loop Network">
          <div className="text-9xl font-semibold tabular-nums">
            {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </div>
          <div className="mt-3 text-3xl text-white/60">
            {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
        </FillerFrame>
      ) : slide.kind === 'filler' ? (
        <FillerFrame title="Loop Network">
          {fillerLabel(slide.card.type) && (
            <div
              className="mb-6 rounded-full px-5 py-1.5 text-2xl font-semibold tracking-wide"
              style={{ background: GOLD, color: '#000' }}
            >
              {fillerLabel(slide.card.type)}
            </div>
          )}
          {slide.card.payload.headline && (
            <div className="max-w-5xl px-8 text-6xl font-semibold leading-tight">
              {slide.card.payload.headline}
            </div>
          )}
          {slide.card.payload.sub && (
            <div className="mt-5 max-w-4xl px-8 text-4xl text-white/70">
              {slide.card.payload.sub}
            </div>
          )}
          {slide.card.payload.foot && (
            <div className="mt-4 text-2xl text-white/40">{slide.card.payload.foot}</div>
          )}
        </FillerFrame>
      ) : (
        <FillerFrame title="Loop Network">
          <Image
            src="/loop-network-logo.png"
            alt="Loop Network"
            width={260}
            height={260}
            className="h-48 w-auto"
          />
          <div className="mt-6 text-4xl font-semibold text-white">Advertise on this screen</div>
          <div className="mt-3 text-2xl text-white/70">
            Reach everyone who walks through the door.
          </div>
          <div
            className="mt-7 rounded-full px-6 py-2 text-2xl font-semibold"
            style={{ background: GOLD, color: '#000' }}
          >
            Get your business on Loop Network
          </div>
        </FillerFrame>
      )}

      {/* Scan-to-act QR (only on ad slides with a destination): a bare,
          gold-framed code in the corner — no card, no caption. The white padding
          is the QR's required quiet zone so it still scans cleanly. */}
      {slide.kind === 'ad' && slide.qr_image && (
        <div className="absolute right-8 bottom-8 rounded-xl bg-white p-1.5 ring-2 ring-[#d4af37]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={slide.qr_image} alt="Scan" className="size-24 rounded-sm" />
        </div>
      )}

      {/* Anti-sleep: a barely-visible element kept in constant motion so TVs
          that sleep on a static frame keep seeing change. See the effect above. */}
      <div
        ref={motionRef}
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 h-1 w-1 rounded-full bg-white/[0.02]"
      />

      {/* Status chips */}
      <div className="pointer-events-none absolute right-4 bottom-4 flex items-center gap-2 text-xs">
        {stale && (
          <span className="rounded-full bg-amber-500/20 px-2 py-1 text-amber-300">offline · cached</span>
        )}
      </div>

      {/* Which screen this is + an unpair control. Hidden during playback (TVs
          can't hover); a tap/remote-click reveals it for a few seconds. */}
      <div
        className={`absolute top-3 right-3 flex items-center gap-2 transition-opacity duration-300 ${
          controlsShown ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {venueName && (
          <span className="rounded-full bg-black/60 px-2.5 py-1 text-xs text-white/70">
            {venueName}
          </span>
        )}
        {!isFullscreen && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              goFullscreen()
            }}
            className="rounded-full bg-black/60 px-2.5 py-1 text-xs text-white/70 hover:bg-black/80 hover:text-white"
          >
            Fullscreen
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (window.confirm('Unpair this screen? It will return to the pairing code entry.'))
              onUnpair()
          }}
          className="rounded-full bg-black/60 px-2.5 py-1 text-xs text-white/70 hover:bg-black/80 hover:text-white"
        >
          Unpair
        </button>
      </div>
    </div>
  )
}

// Live "play trivia" teaser shown on the TV: scannable join QR + game code and a
// live leaderboard. Polls the public state endpoint while it's on screen.
function TriviaSlide({ venueId, code, qrImage }: { venueId: string; code: string; qrImage: string }) {
  const [lb, setLb] = useState<{ name: string; score: number }[]>([])
  const [prompt, setPrompt] = useState<string | null>(null)

  useEffect(() => {
    if (!venueId) return
    let alive = true
    const tick = async () => {
      try {
        const r = await fetch(`/api/trivia/state?venue=${venueId}`, { cache: 'no-store' })
        if (!r.ok) return
        const d = await r.json()
        if (!alive) return
        setLb(d.leaderboard ?? [])
        // Freeze the question for the life of this slide. The slide is only up
        // ~10s but polls every 3s, and the game round rolls every 30s — without
        // this hold, a round boundary inside the slide would swap the prompt to
        // the next question mid-display (the "bounce"). The leaderboard still
        // updates; the prompt holds once set. A fresh question loads next time
        // the trivia slide comes around (the component remounts).
        setPrompt((prev) => prev ?? d.question?.prompt ?? null)
      } catch {
        /* keep last */
      }
    }
    tick()
    const id = setInterval(tick, 3000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [venueId])

  return (
    <div className="flex h-full w-full items-center justify-center gap-16 bg-gradient-to-b from-zinc-900 to-black px-16 text-white">
      <div className="flex flex-col items-center">
        <div className="text-3xl font-extrabold tracking-wide" style={{ color: GOLD }}>
          PLAY TRIVIA
        </div>
        {qrImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrImage} alt="Scan to play" className="mt-6 size-60 rounded-2xl bg-white p-3" />
        )}
        <div className="mt-5 text-2xl text-white/70">Scan to play on your phone</div>
        {code && (
          <div className="mt-1 font-mono text-4xl tracking-widest" style={{ color: GOLD }}>
            {code}
          </div>
        )}
      </div>
      <div className="max-w-xl">
        {prompt && <div className="mb-8 text-4xl font-semibold leading-snug">{prompt}</div>}
        <div className="text-sm uppercase tracking-[0.2em] text-white/40">This Week&apos;s Leaders</div>
        {lb.length ? (
          <ol className="mt-4 space-y-2">
            {lb.slice(0, 2).map((p, i) => (
              <li key={i} className="flex justify-between text-3xl">
                <span>
                  {i + 1}. {p.name}
                </span>
                <span className="font-mono" style={{ color: GOLD }}>
                  {p.score}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="mt-4 text-3xl text-white/50">Be the first to play!</div>
        )}
      </div>
    </div>
  )
}

function FillerFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-zinc-900 to-black text-center">
      {children}
      {title && <div className="absolute top-6 left-8 text-lg text-white/40">{title}</div>}
    </div>
  )
}

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-black text-white/60">
      {children}
    </div>
  )
}

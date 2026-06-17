'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
  venue: { name: string; lat: number | null; lng: number | null; territory: { name: string } | null } | null
  items: AdItem[]
  filler?: FillerCard[]
  generated_at: string
}

type Slide =
  | (AdItem & { kind: 'ad' })
  | { kind: 'weather' }
  | { kind: 'clock' }
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
  // Custom filler cards rotate in order; weather is interleaved separately.
  const cards = m.filler ?? []
  let cardIdx = 0
  const nextFiller = (): Slide =>
    cards.length ? { kind: 'filler', card: cards[cardIdx++ % cards.length] } : { kind: 'weather' }

  if (!m.items.length) {
    // No ads sold yet: cycle clock, weather, any authored cards, house promo.
    const out: Slide[] = [{ kind: 'clock' }, { kind: 'weather' }]
    for (const card of cards) out.push({ kind: 'filler', card })
    out.push({ kind: 'promo' })
    return out
  }
  const out: Slide[] = []
  m.items.forEach((it, i) => {
    out.push({ ...it, kind: 'ad', duration: it.duration || slot })
    // After every 3rd ad drop in a filler card (authored card or weather).
    if ((i + 1) % 3 === 0) out.push(nextFiller())
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

  useEffect(() => {
    setDeviceId(localStorage.getItem(DEVICE_KEY))
    setReady(true)
    // Cache creative media for offline playback.
    if ('serviceWorker' in navigator) {
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
  return <Player deviceId={deviceId} onUnpair={() => { localStorage.removeItem(DEVICE_KEY); setDeviceId(null) }} />
}

/* ---------------- Pairing ---------------- */

function Pairing({ onPaired }: { onPaired: (deviceId: string) => void }) {
  // A provisioned screen carries its pairing code in the kiosk URL
  // (/tv?code=LM-XXXXX) so it pairs itself on first boot with no human input.
  // Read it synchronously so we show a quiet "pairing…" state — not the manual
  // form — while the auto-pair runs. After the first success the device_id lives
  // in localStorage and this screen never reaches pairing again, so the code in
  // the URL is harmless (and is consumed one-time server-side regardless).
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
        // Auto-pair failed (e.g. code already consumed): reveal the manual form
        // so it can still be paired by hand on the bench.
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
          placeholder="LM-XXXXX"
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

function Player({ deviceId, onUnpair }: { deviceId: string; onUnpair: () => void }) {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [index, setIndex] = useState(0)
  const [stale, setStale] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [weather, setWeather] = useState<{ temp: number; code: number } | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
  }, [deviceId, onUnpair])

  // Initial load + periodic resync (45s) so a newly approved ad shows up on the
  // screen within a minute without anyone touching the TV. Also re-sync whenever
  // the tab regains focus/visibility (e.g. someone wakes the screen).
  useEffect(() => {
    loadLoop()
    const id = setInterval(loadLoop, 45 * 1000)
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

  // Heartbeat (30s).
  useEffect(() => {
    const beat = () =>
      fetch('/api/tv/heartbeat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId }),
        keepalive: true,
      }).catch(() => {})
    beat()
    const id = setInterval(beat, 30 * 1000)
    return () => clearInterval(id)
  }, [deviceId])

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

  const playlist = manifest ? buildPlaylist(manifest) : []
  const slide = playlist.length ? playlist[index % playlist.length] : null

  // Advance the loop. Videos advance on `ended`; everything else on a timer.
  useEffect(() => {
    if (!slide) return
    if (slide.kind === 'ad' && slide.creative_type === 'video') return
    const seconds = slide.kind === 'ad' ? slide.duration : FILLER_SECONDS
    timer.current = setTimeout(
      () => setIndex((i) => (i + 1) % Math.max(playlist.length, 1)),
      seconds * 1000
    )
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [slide, index, playlist.length])

  // Proof of play: log each time an ad slide becomes active.
  useEffect(() => {
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
        <FillerFrame title={venueName}>
          <div className="text-[12rem] leading-none">{w?.emoji ?? '🌡️'}</div>
          <div className="mt-4 text-7xl font-semibold">
            {weather ? `${weather.temp}°F` : '—'}
          </div>
          <div className="mt-2 text-3xl text-white/60">{w?.label ?? 'Weather'}</div>
        </FillerFrame>
      ) : slide.kind === 'clock' ? (
        <FillerFrame title={venueName}>
          <div className="text-9xl font-semibold tabular-nums">
            {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </div>
          <div className="mt-3 text-3xl text-white/60">
            {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
        </FillerFrame>
      ) : slide.kind === 'filler' ? (
        <FillerFrame title={venueName}>
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
        <FillerFrame title={venueName}>
          <Image
            src="/loop-network-logo.png"
            alt="Loop Network"
            width={260}
            height={260}
            className="h-48 w-auto"
          />
          <div className="mt-6 text-3xl text-white/70">Your ad could be here.</div>
          <div className="mt-2 text-xl text-white/40">Reach customers across {venueName || 'this venue'}.</div>
        </FillerFrame>
      )}

      {/* Scan-to-act QR (overlaid on ad slides that have a destination) */}
      {slide.kind === 'ad' && slide.qr_image && (
        <div className="absolute bottom-8 left-8 flex items-center gap-3 rounded-2xl bg-white/95 p-3 shadow-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={slide.qr_image} alt="Scan" className="size-24" />
          <div className="pr-2 text-black">
            <div className="text-lg font-semibold leading-tight">Scan for offer</div>
            <div className="text-sm text-black/60">Point your camera here</div>
          </div>
        </div>
      )}

      {/* Status chips */}
      <div className="pointer-events-none absolute right-4 bottom-4 flex items-center gap-2 text-xs">
        {stale && (
          <span className="rounded-full bg-amber-500/20 px-2 py-1 text-amber-300">offline · cached</span>
        )}
      </div>

      {/* Which screen this is + an unpair control. Subtle until hovered so it
          doesn't intrude on the display, but always reachable. */}
      <div className="group absolute top-3 right-3 flex items-center gap-2 opacity-30 transition-opacity hover:opacity-100">
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

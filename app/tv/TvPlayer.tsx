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

type Manifest = {
  tv: { loop_length_seconds: number; slot_seconds: number }
  venue: { name: string; lat: number | null; lng: number | null; territory: { name: string } | null } | null
  items: AdItem[]
  generated_at: string
}

type Slide =
  | (AdItem & { kind: 'ad' })
  | { kind: 'weather' }
  | { kind: 'clock' }
  | { kind: 'promo' }

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
  if (!m.items.length) {
    return [{ kind: 'clock' }, { kind: 'weather' }, { kind: 'promo' }]
  }
  const out: Slide[] = []
  m.items.forEach((it, i) => {
    out.push({ ...it, kind: 'ad', duration: it.duration || slot })
    if ((i + 1) % 4 === 0) out.push({ kind: 'weather' })
  })
  out.push({ kind: 'promo' })
  return out
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
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/tv/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pairing_code: code }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Pairing failed')
      onPaired(data.device_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pairing failed')
      setBusy(false)
    }
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
          placeholder="LN-XXXXX"
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
        Enter the pairing code from your Loop Network admin. The code is shown on
        the TVs page next to this venue.
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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Initial load + periodic resync (5 min).
  useEffect(() => {
    loadLoop()
    const id = setInterval(loadLoop, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [loadLoop])

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
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
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

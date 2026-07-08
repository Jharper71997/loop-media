'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { QR_SIZE_DEFAULT } from '@/lib/adCreative'

const DEVICE_KEY = 'lm_device'
const DEVICE_SECRET_KEY = 'lm_device_secret'

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
  // Free-drag QR center as fractions [0,1] of the 16:9 frame (older cached
  // manifests omit these — default to the old bottom-right spot).
  qr_x?: number
  qr_y?: number
  // QR width as a fraction of the frame width (older manifests omit it).
  qr_size?: number
}

type FillerCard = {
  type: 'weather' | 'sports' | 'trivia' | 'event' | 'promo'
  payload: { headline?: string; sub?: string; foot?: string }
}

type Manifest = {
  tv: {
    loop_length_seconds: number
    slot_seconds: number
    // Per-screen house-slide durations (migration 0050); absent in older cached
    // manifests, so optional — the player falls back to the constants below.
    brewloop_seconds?: number | null
    advertise_seconds?: number | null
    trivia_slide_seconds?: number | null
    filler_seconds?: number | null
    // Overscan safe-area inset per side, as a % of each dimension (migration 0052).
    // Absent in older cached manifests, so optional — the player falls back to the
    // DEFAULT_OVERSCAN_PCT constant below.
    overscan_pct?: number | null
  }
  venue: { id: string; name: string; lat: number | null; lng: number | null; territory: { name: string } | null } | null
  items: AdItem[]
  filler?: FillerCard[]
  trivia?: { code: string; url: string; qr_image: string } | null
  advertise?: { url: string; qr_image: string } | null
  brewloop?: { url: string; qr_image: string } | null
  generated_at: string
  build?: string
}

type Slide =
  | (AdItem & { kind: 'ad' })
  | { kind: 'clock' }
  | { kind: 'trivia' }
  | { kind: 'promo' }
  | { kind: 'brewloop' }
  | { kind: 'filler'; card: FillerCard }

const FILLER_SECONDS = 10
// The trivia join slide holds longer than a plain filler card so a patron can
// read the question and scan without it churning to the next one.
const TRIVIA_SLIDE_SECONDS = 22

// Default overscan safe-area inset (percent per side) when a screen has no
// per-screen overscan_pct set. Default 0 = edge-to-edge (no inset), so screens are
// unchanged unless a specific TV actually overscans — then raise that screen's
// overscan_pct on its admin page (use the on-screen Calibrate tool to find the number).
const DEFAULT_OVERSCAN_PCT = 0
// Clamp any overscan value (per-screen, default, or live calibration) to a sane range.
const clampOverscan = (n: number) => Math.max(0, Math.min(12, n))

function buildPlaylist(m: Manifest): Slide[] {
  const slot = m.tv.slot_seconds || 15
  // Static QR-less trivia cards were retired — the live (QR) trivia game is the
  // only trivia now. Belt-and-suspenders: never render a trivia filler card even
  // if one lingers in the data.
  const cards = (m.filler ?? []).filter((c) => c.type !== 'trivia')
  // Filler pool rotated between ads (and used to fill empty screens): the live
  // trivia teaser, then any authored cards. May be empty (no trivia, no cards).
  const fillerPool: Slide[] = []
  if (m.trivia) fillerPool.push({ kind: 'trivia' })
  for (const card of cards) fillerPool.push({ kind: 'filler', card })
  let fi = 0
  const nextFiller = (): Slide | null =>
    fillerPool.length ? fillerPool[fi++ % fillerPool.length] : null

  // The Jville Brew Loop house ad plays on EVERY screen (only when the manifest
  // carries it). It leads the loop so a screen opens with real content.
  const brewloop: Slide[] = m.brewloop ? [{ kind: 'brewloop' }] : []

  if (!m.items.length) {
    // No ads sold yet: lead with the Brew Loop ad, rotate the filler pool
    // (trivia, authored cards), then the "advertise on this screen" house slide
    // LAST — a new screen shouldn't open by begging for advertisers.
    return [...brewloop, ...fillerPool, { kind: 'promo' }]
  }
  const out: Slide[] = [...brewloop]
  m.items.forEach((it) => {
    out.push({ ...it, kind: 'ad', duration: it.duration || slot })
    // Drop a filler card after each ad (cycling trivia → authored cards) when the
    // pool has anything; otherwise ads just run back to back.
    const f = nextFiller()
    if (f) out.push(f)
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
  const [deviceSecret, setDeviceSecret] = useState<string | null>(null)
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
    const urlSecret = params.get('secret')?.trim()
    // In preview never read/persist the stored device — keep the admin's browser
    // from inheriting (or becoming) a real screen.
    const id = urlDevice || (isPreview ? null : localStorage.getItem(DEVICE_KEY))
    const secret = urlSecret || (isPreview ? null : localStorage.getItem(DEVICE_SECRET_KEY))
    if (id) {
      if (!isPreview) {
        localStorage.setItem(DEVICE_KEY, id)
        if (secret) localStorage.setItem(DEVICE_SECRET_KEY, secret)
      }
      setDeviceId(id)
      if (secret) setDeviceSecret(secret)
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
        onPaired={(id, secret) => {
          localStorage.setItem(DEVICE_KEY, id)
          if (secret) localStorage.setItem(DEVICE_SECRET_KEY, secret)
          setDeviceId(id)
          setDeviceSecret(secret)
        }}
      />
    )
  return (
    <Player
      deviceId={deviceId}
      deviceSecret={deviceSecret}
      preview={preview}
      onUnpair={() => {
        localStorage.removeItem(DEVICE_KEY)
        localStorage.removeItem(DEVICE_SECRET_KEY)
        setDeviceId(null)
        setDeviceSecret(null)
      }}
    />
  )
}

/* ---------------- Pairing ---------------- */

function Pairing({
  onPaired,
}: {
  onPaired: (deviceId: string, deviceSecret: string | null) => void
}) {
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
        onPaired(data.device_id, data.device_secret ?? null)
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
          placeholder="XXXXXXXX"
          maxLength={8}
          className="w-80 rounded-xl border border-white/15 bg-white/5 px-6 py-5 text-center text-3xl tracking-widest uppercase outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={busy || !code}
          className="rounded-xl bg-primary px-8 py-3 text-lg font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? 'Pairing…' : 'Pair screen'}
        </button>
        {error && <p className="text-destructive">{error}</p>}
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
  deviceSecret,
  preview = false,
  onUnpair,
}: {
  deviceId: string
  deviceSecret: string | null
  preview?: boolean
  onUnpair: () => void
}) {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [index, setIndex] = useState(0)
  const [stale, setStale] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [fatal, setFatal] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const motionRef = useRef<HTMLDivElement | null>(null)
  // Count of composited frames since boot (see the rAF loop below). The heartbeat
  // uses the RATE of this counter to tell a truly-painting screen from a Fire
  // Stick that's powered with its TV switched off.
  const framesRef = useRef(0)
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

  // Overscan calibration: a visual aid, opened from the revealed controls (or by
  // loading with ?calibrate=1), that draws the safe-area frame and tints the strip
  // a TV may clip — so someone standing at the venue can SEE the cutoff and dial in
  // the right inset for that TV. `calibrateOverride` is a live preview only; the
  // saved value is the per-screen overscan_pct set on the admin screen page.
  const [calibrating, setCalibrating] = useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('calibrate') === '1'
  )
  const [calibrateOverride, setCalibrateOverride] = useState<number | null>(null)

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
        headers: deviceSecret ? { 'x-device-secret': deviceSecret } : undefined,
      })
      if (res.status === 404 || res.status === 403) {
        // 404 = unpaired/unknown device; 403 = device secret rejected (e.g. the
        // code was regenerated to move the screen). Either way, drop to pairing.
        onUnpair()
        return
      }
      if (!res.ok) throw new Error('fetch failed')
      const data: Manifest = await res.json()
      // Self-update: reload once when the deployed build changes — for real
      // screens AND the admin preview, so a peek always reflects the latest
      // deploy instead of the build it happened to open on. First load records it.
      if (data.build) {
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
  }, [deviceId, deviceSecret, onUnpair, preview])

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

  // Frame counter driving the "is it really painting" check in the heartbeat.
  // A perpetual requestAnimationFrame loop ticks once per composited frame
  // (~60/sec on an active display). When the TV is off / dimmed / in a
  // screensaver the compositor stalls and these frames dry up — EVEN THOUGH
  // document.visibilityState can still read 'visible' on a powered Fire Stick.
  // That divergence is exactly how a dark TV used to report itself "live". Cheap:
  // one integer bump per frame.
  useEffect(() => {
    let raf = 0
    const loop = () => {
      framesRef.current++
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Heartbeat (30s) — the ONLY signal behind the admin/host "Live" dot. Skipped
  // in admin preview so a peek doesn't fake a screen live. We beat only when the
  // page is visible AND actually painting frames: a Fire Stick left powered with
  // its TV switched off keeps the page "visible" and would otherwise heartbeat
  // forever, reporting a dark TV as live. Requiring real paint (>= ~1 fps over the
  // window) means a dimmed / screensaver / slept display stops beating and the
  // dashboard flips to Offline within ~95s. The reliable hardware complement is
  // HDMI-CEC on the stick (TV off -> stick standby -> page frozen -> beats stop);
  // this paint gate is the software net under it. A wake (visibilitychange) beats
  // immediately since that's a fresh positive signal.
  useEffect(() => {
    if (preview) return
    const MIN_PAINT_FPS = 1
    let baselineFrames = framesRef.current
    let baselineAt = performance.now()
    const send = () => {
      fetch('/api/tv/heartbeat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(deviceSecret ? { 'x-device-secret': deviceSecret } : {}),
        },
        body: JSON.stringify({ device_id: deviceId }),
        keepalive: true,
      }).catch(() => {})
    }
    const beat = (force = false) => {
      if (document.visibilityState !== 'visible') return
      const now = performance.now()
      const frames = framesRef.current - baselineFrames
      const secs = (now - baselineAt) / 1000
      baselineFrames = framesRef.current
      baselineAt = now
      // Compositor stalled since the last beat -> the screen isn't really showing
      // anything. Don't beat; let the freshness window flip it Offline.
      if (!force && secs > 0 && frames < secs * MIN_PAINT_FPS) return
      send()
    }
    beat(true) // first beat: the page just rendered on a live screen
    const id = setInterval(() => beat(), 30 * 1000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') beat(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [deviceId, deviceSecret, preview])

  // Clock tick.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Memoized so the playlist (and the current `slide`) keep a stable reference
  // between renders. Without this, the 1s clock tick rebuilt `slide` every
  // second, which reset the advance timer below before it could fire — freezing
  // the loop on the first ad and hiding every later slot.
  const playlist = useMemo(() => (manifest ? buildPlaylist(manifest) : []), [manifest])
  const slide = playlist.length ? playlist[index % playlist.length] : null

  // How long this slide holds. Videos run to their own `ended` event; everything
  // else (images, filler, promo) uses the admin-set seconds.
  const isVideoAd = slide?.kind === 'ad' && slide.creative_type === 'video'
  // Ads use their own per-ad seconds; each house slide uses its per-screen time
  // (admin-set on the screen page) or falls back to the built-in default.
  const slideSeconds = !slide
    ? 0
    : slide.kind === 'ad'
      ? slide.duration
      : slide.kind === 'trivia'
        ? (manifest?.tv.trivia_slide_seconds ?? TRIVIA_SLIDE_SECONDS)
        : slide.kind === 'brewloop'
          ? (manifest?.tv.brewloop_seconds ?? FILLER_SECONDS)
          : slide.kind === 'promo'
            ? (manifest?.tv.advertise_seconds ?? FILLER_SECONDS)
            : (manifest?.tv.filler_seconds ?? FILLER_SECONDS)

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
      headers: {
        'content-type': 'application/json',
        ...(deviceSecret ? { 'x-device-secret': deviceSecret } : {}),
      },
      body: JSON.stringify({ device_id: deviceId, ad_id: slide.id }),
      keepalive: true,
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, deviceId])

  const advance = () => setIndex((i) => (i + 1) % Math.max(playlist.length, 1))

  if (fatal) return <Splash retry>{fatal}</Splash>
  if (!manifest || !slide) return <Splash>Loading loop…</Splash>

  const venueName = manifest.venue?.name ?? ''
  // Effective safe-area inset for this screen: live calibration preview if active,
  // else the per-screen saved value, else the built-in default.
  const overscanPct = clampOverscan(
    calibrateOverride ?? manifest.tv.overscan_pct ?? DEFAULT_OVERSCAN_PCT
  )
  const bumpOverscan = (delta: number) =>
    setCalibrateOverride((v) =>
      clampOverscan((v ?? manifest.tv.overscan_pct ?? DEFAULT_OVERSCAN_PCT) + delta)
    )

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-black text-white"
      onClick={() => {
        if (!document.fullscreenElement) goFullscreen()
        revealControls()
      }}
    >
      {/* Motion: a soft fade on every slide. Videos keep object-contain (never crop
          footage); image ads ALSO use object-contain so a creative that isn't 16:9
          shows WHOLE — its top/bottom (or sides) are never sliced off. A true 16:9 ad
          fills the frame edge-to-edge; anything else letterboxes onto the black field
          instead of being cropped. (We dropped object-cover, which zoomed-and-cropped
          non-16:9 ads — visible as "zoomed in, parts missing" at /tv in a browser.) */}
      <style>{`
        @keyframes lm-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes lm-kenburns { from { transform: scale(1.06) } to { transform: scale(1.0) } }
        .lm-fade { animation: lm-fade 600ms ease-out both }
        .lm-ken { animation: lm-kenburns 9s ease-out both }
        @media (prefers-reduced-motion: reduce) { .lm-ken { animation: none } }
      `}</style>
      {/* Overscan-safe stage: ALL content lives inside this inset rectangle, so a TV
          that zooms past its panel edges only eats the surrounding black margin —
          never the corner QR or the edges of an ad. The inset width is the screen's
          overscan_pct (default 3%), tunable via the calibration overlay below. */}
      <div className="absolute overflow-hidden" style={{ inset: `${overscanPct}%` }}>
      {slide.kind === 'ad' ? (
        slide.creative_type === 'video' ? (
          <video
            key={slide.id + index}
            src={slide.creative_url}
            className="lm-fade h-full w-full object-contain"
            autoPlay
            muted
            playsInline
            onEnded={advance}
            onError={advance}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={slide.id + index}
            src={slide.creative_url}
            alt={slide.title}
            className="lm-fade h-full w-full object-contain"
          />
        )
      ) : slide.kind === 'trivia' ? (
        <TriviaSlide
          venueId={manifest.venue?.id ?? ''}
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
            <div className="mb-6 rounded-full bg-primary px-5 py-1.5 text-2xl font-semibold tracking-wide text-primary-foreground">
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
      ) : slide.kind === 'brewloop' ? (
        <BrewLoopAd qrImage={manifest.brewloop?.qr_image ?? ''} />
      ) : (
        <AdvertiseAd qrImage={manifest.advertise?.qr_image ?? ''} />
      )}

      {/* Scan-to-act QR (only on ad slides with a destination): a bare,
          gold-framed code in the corner — no card, no caption. The white padding
          is the QR's required quiet zone so it still scans cleanly. */}
      {slide.kind === 'ad' && slide.qr_image && (
        <div
          className="absolute rounded-xl bg-white p-1.5 ring-2 ring-primary"
          style={{
            left: `${(slide.qr_x ?? 0.9) * 100}%`,
            top: `${(slide.qr_y ?? 0.88) * 100}%`,
            width: `${(slide.qr_size ?? QR_SIZE_DEFAULT) * 100}%`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={slide.qr_image} alt="Scan" className="block w-full rounded-sm" />
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
          <span className="rounded-full bg-warning/20 px-2 py-1 text-warning">offline · cached</span>
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
            setCalibrating(true)
            revealControls()
          }}
          className="rounded-full bg-black/60 px-2.5 py-1 text-xs text-white/70 hover:bg-black/80 hover:text-white"
        >
          Calibrate
        </button>
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

      {/* Overscan calibration overlay — draws the current safe-area frame over the
          live loop and tints the strip a TV may clip, with +/- to find the right
          inset for this TV. Rendered at the root (not inside the inset stage) so its
          frame sits exactly at the stage edge. */}
      {calibrating && (
        <CalibrationOverlay
          pct={overscanPct}
          onBump={bumpOverscan}
          onClose={() => {
            setCalibrating(false)
            setCalibrateOverride(null)
          }}
        />
      )}
    </div>
  )
}

// The overscan calibration overlay. Purely a visual aid: it previews the inset live
// (via +/-) so someone at the venue can see exactly what their TV cuts off and read
// off the right number. The value is SAVED on the admin screen page (overscan_pct);
// closing here reverts the preview to the saved value.
function CalibrationOverlay({
  pct,
  onBump,
  onClose,
}: {
  pct: number
  onBump: (delta: number) => void
  onClose: () => void
}) {
  // Keyboard support for anyone with a paired keyboard: up/down (or +/-) adjust,
  // Escape closes. On-screen buttons cover TV remotes / touch displays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === '+' || e.key === '=') {
        e.preventDefault()
        onBump(1)
      } else if (e.key === 'ArrowDown' || e.key === '-' || e.key === '_') {
        e.preventDefault()
        onBump(-1)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBump, onClose])

  const btn =
    'grid size-14 place-items-center rounded-full bg-white/10 text-3xl font-bold text-white ring-1 ring-white/30 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-yellow-300'

  return (
    // Stop clicks from bubbling to the root (which would toggle fullscreen).
    <div className="absolute inset-0 z-50" onClick={(e) => e.stopPropagation()}>
      {/* The frame marks the safe area; the box-shadow spread floods everything
          OUTSIDE it with translucent red — the strip a TV may clip. */}
      <div
        className="pointer-events-none absolute rounded-sm border-2 border-dashed border-yellow-300"
        style={{ inset: `${pct}%`, boxShadow: '0 0 0 9999px rgba(220,38,38,0.32)' }}
      />
      <div className="absolute left-1/2 top-1/2 w-[min(90%,34rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-black/85 px-8 py-6 text-center backdrop-blur">
        <div className="text-xs font-semibold uppercase tracking-[0.25em] text-yellow-300">
          Screen calibration
        </div>
        <div className="mt-2 text-7xl font-bold tabular-nums text-white">{pct}%</div>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/70">
          The <span className="text-yellow-300">yellow frame</span> is the safe area. The{' '}
          <span className="text-red-400">red edge</span> is what your TV may cut off. Raise this
          until nothing important — the QR, the edges of an ad — sits in the red.
        </p>
        <div className="mt-6 flex items-center justify-center gap-6">
          <button aria-label="Less inset" className={btn} onClick={() => onBump(-1)}>
            −
          </button>
          <button aria-label="More inset" className={btn} onClick={() => onBump(1)}>
            +
          </button>
        </div>
        <p className="mt-5 text-xs leading-relaxed text-white/50">
          Then set this screen&apos;s overscan to{' '}
          <span className="font-semibold text-white">{pct}%</span> in your Loop Network dashboard to
          save it for good.
        </p>
        <button
          onClick={onClose}
          className="mt-4 rounded-full bg-white/15 px-6 py-2 text-sm font-medium text-white ring-1 ring-white/25 hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-yellow-300"
        >
          Done
        </button>
      </div>
    </div>
  )
}

// Live "play trivia" teaser shown on the TV: a scannable join QR and this week's
// leaderboard. The GAME QUESTION is intentionally NOT shown here — it's answered
// on the phone. Putting the live question on the TV made it look like it "skipped"
// (the question changes across slide appearances and at round boundaries), so the
// TV now only invites people to scan and tracks the standings, which update
// smoothly. Polls the public state endpoint for the leaderboard while on screen.
function TriviaSlide({ venueId, qrImage }: { venueId: string; qrImage: string }) {
  const [lb, setLb] = useState<{ name: string; score: number }[]>([])

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
      } catch {
        /* keep last */
      }
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [venueId])

  return (
    <div className="flex h-full w-full items-center justify-center gap-16 bg-gradient-to-br from-[#1c1813] via-[#100e0a] to-black px-16 text-white">
      <div className="flex flex-col items-center">
        <div className="text-3xl font-extrabold tracking-wide text-primary">PLAY TRIVIA</div>
        {qrImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrImage} alt="Scan to play" className="mt-6 size-60 rounded-2xl bg-white p-3" />
        )}
        <div className="mt-5 text-2xl text-white/70">Scan to play on your phone</div>
      </div>
      <div className="max-w-xl">
        <div className="font-heading text-5xl font-extrabold leading-tight">
          Trivia night,
          <br />
          <span className="text-primary">live on your phone.</span>
        </div>
        <div className="mt-4 text-2xl text-white/60">
          Answer from your seat and climb this week&apos;s leaderboard.
        </div>
        <div className="mt-8 text-sm uppercase tracking-[0.2em] text-white/40">
          This Week&apos;s Leaders
        </div>
        {lb.length ? (
          <ol className="mt-4 space-y-2">
            {lb.slice(0, 3).map((p, i) => (
              <li key={i} className="flex justify-between text-3xl">
                <span>
                  {i + 1}. {p.name}
                </span>
                <span className="font-mono text-primary">{p.score}</span>
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

// The Jville Brew Loop house ad — a real two-column advertisement (brand + hook on
// the left, the $5-off offer + scannable QR on the right) rather than a logo
// dropped on a card. Uses the TRANSPARENT round badge so nothing renders as a
// black block. Brand voice: shared shuttle, "friends", no alcohol/DUI angle.
function BrewLoopAd({ qrImage }: { qrImage: string }) {
  return (
    <div className="relative flex h-full w-full items-center justify-center gap-20 overflow-hidden bg-gradient-to-br from-[#171310] via-[#0c0a07] to-black px-20 text-white">
      {/* soft gold glow behind the brand */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 -left-40 h-[42rem] w-[42rem] -translate-y-1/2 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative z-10 max-w-2xl">
        <Image
          src="/brewloop-badge.png"
          alt="Jville Brew Loop"
          width={1024}
          height={1024}
          priority
          className="size-44 drop-shadow-[0_0_30px_rgba(212,163,51,0.35)]"
        />
        <div className="mt-8 font-heading text-7xl font-extrabold leading-[0.95] tracking-tight">
          One ticket.
          <br />
          <span className="text-primary">Ride all night.</span>
        </div>
        <div className="mt-6 max-w-xl text-3xl leading-snug text-white/70">
          A shared shuttle that loops between town&apos;s best local spots. Hop on, hop off, all
          night long.
        </div>
      </div>
      <div className="relative z-10 flex flex-col items-center">
        <div className="font-heading text-8xl font-black leading-none text-primary drop-shadow">
          $5 OFF
        </div>
        <div className="mt-3 text-2xl font-medium text-white/80">your first ride</div>
        {qrImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrImage}
            alt="Scan to book"
            className="mt-8 size-64 rounded-3xl bg-white p-4 ring-4 ring-primary"
          />
        )}
        <div className="mt-6 text-center text-2xl text-white/70">
          Scan to book &middot; code{' '}
          <span className="font-mono font-bold text-white">LOOP5</span>
        </div>
      </div>
    </div>
  )
}

// The "advertise on this screen" house ad. Renders the full Loop Network logo
// lockup LARGE (it was tiny before) on a flat near-black field that matches the
// logo art's own dark background, so there's no visible rectangle seam.
function AdvertiseAd({ qrImage }: { qrImage: string }) {
  return (
    <div className="relative flex h-full w-full items-center justify-center gap-16 overflow-hidden bg-[#0a0908] px-16 text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 right-0 h-[40rem] w-[40rem] rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative z-10 flex flex-1 justify-center">
        <Image
          src="/loop-network-logo.png"
          alt="Loop Network"
          width={1244}
          height={1244}
          priority
          className="w-[27rem] max-w-full"
        />
      </div>
      <div className="relative z-10 flex flex-1 flex-col items-start">
        <div className="font-heading text-6xl font-extrabold leading-[1.05]">
          Your business,
          <br />
          <span className="text-primary">on this screen.</span>
        </div>
        <div className="mt-5 max-w-lg text-3xl leading-snug text-white/70">
          Local ads people actually see, right where your customers already are.
        </div>
        {qrImage ? (
          <div className="mt-9 flex items-center gap-7">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrImage}
              alt="Scan to advertise"
              className="size-44 rounded-2xl bg-white p-3.5 ring-4 ring-primary"
            />
            <div className="text-left">
              <div className="font-heading text-5xl font-extrabold text-primary">Advertise here</div>
              <div className="mt-2 text-2xl text-white/70">Scan to get started</div>
            </div>
          </div>
        ) : (
          <div className="mt-9 rounded-full bg-primary px-8 py-3 text-2xl font-semibold text-primary-foreground">
            Scan to advertise on Loop Network
          </div>
        )}
      </div>
    </div>
  )
}

function FillerFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#1c1813] via-[#100e0a] to-black text-center text-white">
      {children}
      {title && (
        <div className="absolute left-8 top-6 font-heading text-lg font-semibold tracking-[0.18em] text-primary/80">
          LOOP NETWORK
        </div>
      )}
    </div>
  )
}

function Splash({ children, retry }: { children: React.ReactNode; retry?: boolean }) {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-5 bg-black text-white/60">
      {/* Branded splash to match the 404 / error pages instead of a bare screen. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/loop-network-emblem.png" alt="Loop Network" className="h-16 w-auto opacity-90" />
      <div className="text-center text-sm">{children}</div>
      {retry && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10"
        >
          Retry
        </button>
      )}
    </div>
  )
}

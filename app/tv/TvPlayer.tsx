'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { QR_SIZE_DEFAULT } from '@/lib/adCreative'
import { QrChip } from '@/components/app/QrChip'
import { CreativeVideo } from '@/components/app/CreativeVideo'
import { ANSWER_SECONDS, ROUND_SECONDS, pointsWithMsLeft } from '@/lib/trivia'
import { cn } from '@/lib/utils'

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

// Fallback hold time for the house slides (Brew Loop ad, "advertise here" card,
// authored filler) when a screen has no per-screen value — an older cached manifest,
// or a row predating the explicit defaults. 15s to match a paid slot, so house cards
// run at the same beat as the ads around them. Mirrors DEFAULT_HOUSE_SLIDE_SECONDS
// in lib/tv.ts (which this client component can't import — it pulls in node:crypto).
const FILLER_SECONDS = 15
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

// The TV is authored on a FIXED 1920x1080 canvas and then scaled as a whole to fit
// whatever the device's browser viewport actually is (a Fire Stick may report 1280x720,
// a laptop something non-16:9, etc.). Every slide — uploaded ads AND the house slides
// (Brew Loop $5-off, "Advertise here", trivia teaser) — is laid out in these 1080p
// coordinates, so nothing can overflow or clip on a screen that isn't exactly 1080p.
// Without this, the house slides' fixed pixel sizes (huge headlines, big QR) spilled
// past the edges on any device whose browser canvas wasn't 1920x1080 — the "zoomed in,
// edges cut off" report. Scaling the whole canvas makes the layout resolution-independent.
const STAGE_W = 1920
const STAGE_H = 1080

// A video ad advances on its own `ended`, but it can never run past the slot it was
// sold — the player hard-cuts there (see VideoAdSlide). Two graces sit around the cut:
// CUT_GRACE_MS lets a clip baked to exactly the slot length finish naturally instead
// of losing its last frame in a photo-finish with the timer, and LOAD_GRACE_MS holds
// the cut open while a creative is still buffering on venue WiFi so a slow load
// doesn't eat the ad's airtime. The load grace doubles as the stall backstop: a
// creative that never plays at all is cut ~25s in rather than freezing the screen.
const CUT_GRACE_MS = 500
const LOAD_GRACE_MS = 10_000

function buildPlaylist(m: Manifest): Slide[] {
  const slot = m.tv.slot_seconds || 15
  // Static QR-less trivia cards were retired — the live (QR) trivia game is the
  // only trivia now. Belt-and-suspenders: never render a trivia filler card even
  // if one lingers in the data.
  const cards = (m.filler ?? []).filter((c) => c.type !== 'trivia')
  // Between-ad filler pool: AUTHORED cards only, cycled after ads. The live trivia
  // teaser is deliberately NOT in this pool — it's inserted ONCE per loop (below).
  // Otherwise a single-item pool (just trivia, the common case) put a trivia slide
  // after EVERY ad — "ad, trivia, ad, trivia". Trivia should show once per cycle.
  const fillerPool: Slide[] = cards.map((card) => ({ kind: 'filler' as const, card }))
  let fi = 0
  const nextFiller = (): Slide | null =>
    fillerPool.length ? fillerPool[fi++ % fillerPool.length] : null

  // The Jville Brew Loop house ad plays on EVERY screen (only when the manifest
  // carries it). It leads the loop so a screen opens with real content.
  const brewloop: Slide[] = m.brewloop ? [{ kind: 'brewloop' }] : []
  // The live trivia teaser — shown ONCE per loop cycle when the venue has trivia
  // on, not repeated between ads.
  const triviaOnce: Slide[] = m.trivia ? [{ kind: 'trivia' as const }] : []

  if (!m.items.length) {
    // No ads sold yet: lead with the Brew Loop ad, then the single trivia teaser,
    // then any authored cards, then the "advertise on this screen" house slide
    // LAST — a new screen shouldn't open by begging for advertisers.
    return [...brewloop, ...triviaOnce, ...fillerPool, { kind: 'promo' }]
  }
  const out: Slide[] = [...brewloop]
  m.items.forEach((it, i) => {
    out.push({ ...it, kind: 'ad', duration: it.duration || slot })
    // Trivia teaser goes in ONCE, after the first ad. Every other gap draws an
    // authored filler card if there is one; otherwise ads just run back to back.
    if (i === 0 && triviaOnce.length) {
      out.push(triviaOnce[0])
    } else {
      const f = nextFiller()
      if (f) out.push(f)
    }
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

  // How long this slide holds. Videos manage their own advance (own `ended`, capped
  // at the slot — see VideoAdSlide); everything else (images, filler, promo) uses the
  // admin-set seconds on the timer below.
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

        /* Trivia motion. Everything here animates TRANSFORM or OPACITY only — a Fire
           Stick composites those on the GPU, while animating blur/size/color would
           re-rasterize every frame and stutter. */
        @keyframes lm-rise { from { opacity: 0; transform: translateY(26px) } to { opacity: 1; transform: none } }
        @keyframes lm-pop { 0% { transform: scale(1) } 45% { transform: scale(1.045) } 100% { transform: scale(1) } }
        @keyframes lm-ping { 0% { transform: scale(1); opacity: .7 } 75%, 100% { transform: scale(2.2); opacity: 0 } }
        @keyframes lm-tick { from { transform: scale(1.28); opacity: .55 } to { transform: scale(1); opacity: 1 } }
        @keyframes lm-urgent { 0%, 100% { opacity: 1 } 50% { opacity: .45 } }
        @keyframes lm-breathe { 0%, 100% { transform: scale(1); opacity: .35 } 50% { transform: scale(1.09); opacity: .7 } }
        @keyframes lm-drift-a { 0%, 100% { transform: translate3d(0,0,0) scale(1) } 50% { transform: translate3d(90px,60px,0) scale(1.12) } }
        @keyframes lm-drift-b { 0%, 100% { transform: translate3d(0,0,0) scale(1.08) } 50% { transform: translate3d(-70px,-50px,0) scale(1) } }
        .lm-rise { animation: lm-rise 520ms cubic-bezier(.22,1,.36,1) both }
        .lm-pop { animation: lm-pop 620ms ease-out }
        .lm-ping { animation: lm-ping 1.8s cubic-bezier(0,0,.2,1) infinite }
        .lm-tick { display: inline-block; animation: lm-tick 320ms ease-out }
        .lm-urgent { animation: lm-urgent 900ms ease-in-out infinite }
        .lm-breathe { animation: lm-breathe 3.2s ease-in-out infinite }
        .lm-drift-a { animation: lm-drift-a 22s ease-in-out infinite }
        .lm-drift-b { animation: lm-drift-b 26s ease-in-out infinite }

        /* House-ad motion: the Brew Loop route circling with its stops firing in
           sequence, and the empty-spot frame on the "advertise here" card. */
        @keyframes lm-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes lm-stop { 0%, 70%, 100% { transform: scale(1); opacity: .45 } 20% { transform: scale(1.9); opacity: 1 } }
        @keyframes lm-sweep { from { transform: translateX(0) rotate(12deg) } to { transform: translateX(560%) rotate(12deg) } }
        @keyframes lm-caret { 0%, 45% { opacity: 1 } 55%, 100% { opacity: 0 } }
        @keyframes lm-bracket { 0%, 100% { opacity: .45 } 50% { opacity: 1 } }
        .lm-spin { animation: lm-spin 60s linear infinite }
        .lm-stop { animation: lm-stop 2.6s ease-in-out infinite }
        .lm-sweep { animation: lm-sweep 9s ease-in-out infinite }
        .lm-caret { animation: lm-caret 1.1s step-end infinite }
        .lm-bracket { animation: lm-bracket 2.4s ease-in-out infinite }
        @media (prefers-reduced-motion: reduce) {
          .lm-ken, .lm-rise, .lm-pop, .lm-ping, .lm-tick, .lm-urgent, .lm-breathe,
          .lm-drift-a, .lm-drift-b, .lm-spin, .lm-stop, .lm-sweep, .lm-caret,
          .lm-bracket { animation: none }
        }
      `}</style>
      {/* Fixed 1920x1080 canvas scaled to fit this device's viewport as a whole, so
          every slide is laid out at 1080p and can't overflow/clip on a Fire Stick or
          browser whose canvas isn't exactly 1920x1080. */}
      <StageFit>
      {/* Overscan-safe stage: ALL content lives inside this inset rectangle, so a TV
          that zooms past its panel edges only eats the surrounding black margin —
          never the corner QR or the edges of an ad. Default 0 = edge-to-edge; raise a
          screen's overscan_pct only for a physical TV that clips its own edges. */}
      <div className="absolute overflow-hidden" style={{ inset: `${overscanPct}%` }}>
      {slide.kind === 'ad' ? (
        slide.creative_type === 'video' ? (
          <VideoAdSlide
            key={slide.id + index}
            src={slide.creative_url}
            // Never longer than the slot this screen sells, even if the ad's stored
            // duration says otherwise (a legacy ad predating the upload-time trim, or
            // an admin override). The slot is the contract; the ad bends to it.
            cutMs={Math.min(slide.duration, manifest.tv.slot_seconds || 15) * 1000}
            onDone={advance}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={slide.id + index}
            src={slide.creative_url}
            alt={slide.title}
            className="lm-fade h-full w-full object-contain"
            // A broken / unreadable image ad skips to the next slide instead of sitting
            // as a broken-image icon for the whole slot.
            onError={advance}
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
        <QrChip
          src={slide.qr_image}
          x={slide.qr_x ?? 0.9}
          y={slide.qr_y ?? 0.88}
          size={slide.qr_size ?? QR_SIZE_DEFAULT}
        />
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

      </div>
      </StageFit>

      {/* Which screen this is + an unpair control — kept at viewport scale (outside the
          scaled canvas) so it stays a tappable size. Hidden during playback (TVs can't
          hover); a tap/remote-click reveals it for a few seconds. */}
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

// A video ad that manages its own advance, bounded by `cutMs` — the slot it was sold.
// A clip SHORTER than the slot still advances early on its own `ended` (a 9s ad doesn't
// sit for 15s). A clip LONGER than the slot is cut here, which is the only thing
// stopping one over-length upload from holding the loop while every other advertiser
// on the screen waits. That same cut is the stall backstop: an upload that silently
// fails to fire ended/error in a TV WebView (wrong codec, truncated file) is skipped
// rather than freezing the screen on one slide.
//
// The cut is armed against PLAYBACK, not mount — a creative still buffering on a
// venue's WiFi would otherwise burn its slot while showing nothing. Until playback
// starts, a longer backstop covers the never-plays case.
function VideoAdSlide({ src, cutMs, onDone }: { src: string; cutMs: number; onDone: () => void }) {
  const ref = useRef<HTMLVideoElement | null>(null)
  // Hold the latest onDone in a ref so the effect arms once per src, not on every
  // parent re-render (the 1s clock tick would otherwise keep re-arming it).
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let fired = false
    const finish = () => {
      if (fired) return
      fired = true
      doneRef.current()
    }
    // Backstop while the creative loads; re-armed to the real cut once it plays.
    let cut = window.setTimeout(finish, cutMs + LOAD_GRACE_MS)
    let started = false
    const onPlaying = () => {
      // `playing` also fires after a mid-clip rebuffer — only the first one starts
      // the slot clock, or a stuttering ad would keep extending its own airtime.
      if (started) return
      started = true
      window.clearTimeout(cut)
      cut = window.setTimeout(finish, cutMs + CUT_GRACE_MS)
    }
    el.addEventListener('playing', onPlaying)
    el.addEventListener('ended', finish)
    el.addEventListener('error', finish)
    return () => {
      window.clearTimeout(cut)
      el.removeEventListener('playing', onPlaying)
      el.removeEventListener('ended', finish)
      el.removeEventListener('error', finish)
    }
  }, [src, cutMs])
  return <CreativeVideo ref={ref} src={src} className="lm-fade" autoPlay muted playsInline />
}

// A fixed 1920x1080 design canvas scaled to fit the device's viewport as a whole. The
// child is authored at 1080p; we scale it by the SMALLER of the width/height ratios so
// it always fits (letterboxed on the black field) and never overflows — an identical
// layout on a Fire Stick that reports 1280x720, a non-16:9 browser window, or a real
// 1080p TV. This is what keeps the house slides' fixed pixel sizes from spilling past
// the edges ("zoomed in, cut off") on any device whose canvas isn't exactly 1920x1080.
function StageFit({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const fit = () => {
      const s = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H)
      // Guard a transient 0 / invalid viewport (some TV WebViews report 0 on the
      // first tick) so the canvas can never scale to nothing and blank the screen.
      setScale(Number.isFinite(s) && s > 0 ? s : 1)
    }
    fit()
    // Re-measure once after first paint in case the WebView reported a stale size
    // at mount, then on every resize/orientation change thereafter.
    const raf = requestAnimationFrame(fit)
    window.addEventListener('resize', fit)
    window.addEventListener('orientationchange', fit)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
      window.removeEventListener('orientationchange', fit)
    }
  }, [])
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {/* Center via absolute + translate(-50%,-50%) — NOT CSS grid. A grid track sizes
          itself to the 1920px canvas and centers the SCALED canvas inside that oversized
          track, shoving it down-and-right so only the top-left shows on a smaller
          viewport (the Fire Stick symptom). Absolute+translate centers against the
          viewport itself, so the scaled canvas is always dead-center and letterboxed. */}
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: STAGE_W,
          height: STAGE_H,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        {children}
      </div>
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

// Live trivia on the TV: the CURRENT QUESTION and its four choices, a countdown,
// the answer reveal when the round closes, plus the join QR and this week's top 3.
//
// The question used to be withheld here (it looked like it "skipped" when the
// round rolled over mid-slide). It's on screen now because a bar TV showing only
// a QR gives nobody a reason to scan — but the churn is handled instead of hidden:
// every state carries a visible countdown ("18s to answer" / "next question in
// 6s"), so a rollover reads as the game moving on, not as a glitch.
//
// Round timing comes from the SERVER's endsInMs (anchored to a local timestamp on
// each poll), not from the TV's own clock — a Fire Stick with a skewed clock would
// otherwise count down to the wrong question. The countdown ticks locally between
// polls and forces an immediate refetch the moment it hits zero, so the reveal and
// the next question land on time.
type TriviaLive = {
  round: number
  phase: 'question' | 'results'
  endsAt: number // local ms timestamp the current phase ends at
  prompt: string
  choices: string[]
  correctIdx: number | null
}

function TriviaSlide({ venueId, qrImage }: { venueId: string; qrImage: string }) {
  const [lb, setLb] = useState<{ name: string; score: number }[]>([])
  const [live, setLive] = useState<TriviaLive | null>(null)
  const [secs, setSecs] = useState(0)
  const refetch = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!venueId) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      if (timer) clearTimeout(timer)
      try {
        const r = await fetch(`/api/trivia/state?venue=${venueId}`, { cache: 'no-store' })
        if (r.ok) {
          const d = await r.json()
          if (!alive) return
          setLb(d.leaderboard ?? [])
          if (d.question?.prompt) {
            setLive({
              round: d.round,
              phase: d.phase === 'results' ? 'results' : 'question',
              endsAt: Date.now() + Math.max(0, d.endsInMs ?? 0),
              prompt: d.question.prompt,
              choices: Array.isArray(d.question.choices) ? d.question.choices : [],
              correctIdx: typeof d.correctIdx === 'number' ? d.correctIdx : null,
            })
          }
        }
      } catch {
        /* keep the last state on screen */
      } finally {
        // Poll fast enough that the reveal + the next question show up promptly;
        // the slide is only on screen ~20s per loop cycle, so this is a handful of
        // reads, not a standing load.
        if (alive) timer = setTimeout(tick, 2500)
      }
    }
    refetch.current = tick
    tick()
    return () => {
      alive = false
      refetch.current = null
      if (timer) clearTimeout(timer)
    }
  }, [venueId])

  // Local countdown off the server anchor. When a phase expires, pull fresh state
  // right away rather than waiting out the poll interval.
  useEffect(() => {
    if (!live) return
    // Only chase the rollover for an anchor that was still in the future when it
    // arrived. An already-expired anchor (a poll that landed right on the boundary)
    // would otherwise refetch, expire again, and spin the endpoint — let the normal
    // poll pick that one up instead.
    let fired = live.endsAt <= Date.now()
    const t = () => {
      const left = Math.max(0, Math.ceil((live.endsAt - Date.now()) / 1000))
      setSecs(left)
      if (left === 0 && !fired) {
        fired = true
        refetch.current?.()
      }
    }
    t()
    const id = setInterval(t, 250)
    return () => clearInterval(id)
  }, [live])

  const reveal = live?.phase === 'results'
  const total = reveal ? ROUND_SECONDS - ANSWER_SECONDS : ANSWER_SECONDS
  const pct = Math.max(0, Math.min(100, (secs / total) * 100))
  // Urgency ramp on the answer clock: gold most of the round, amber inside 15s, red
  // and pulsing inside 5s. A bar TV competes with conversation for attention — the
  // color change is what pulls an eye back mid-round.
  const urgent = !reveal && secs <= 5
  const warm = !reveal && secs <= 15
  // Points the current question is still worth (same curve the phone counts down
  // and the server pays out).
  const worth = pointsWithMsLeft(secs * 1000)
  const timeColor = reveal
    ? 'text-success'
    : urgent
      ? 'text-red-400'
      : warm
        ? 'text-amber-300'
        : 'text-primary'
  const barColor = reveal
    ? 'bg-success'
    : urgent
      ? 'bg-red-500'
      : warm
        ? 'bg-amber-400'
        : 'bg-primary'

  return (
    <div className="relative flex h-full w-full items-center gap-14 overflow-hidden bg-gradient-to-br from-[#1c1813] via-[#100e0a] to-black px-16 py-14 text-white">
      {/* Drifting light. Two static-blur blobs moved with transform/opacity only —
          a Fire Stick can composite that, but re-rastering an animated blur would
          drop frames. The second blob turns green on the reveal so the whole screen
          shifts color when the answer lands, not just the choice chip. */}
      <div
        aria-hidden
        className="lm-drift-a pointer-events-none absolute -left-32 top-[-15%] size-[46rem] rounded-full bg-primary/[0.09] blur-2xl"
      />
      <div
        aria-hidden
        className={cn(
          'lm-drift-b pointer-events-none absolute -right-40 bottom-[-20%] size-[42rem] rounded-full blur-2xl transition-colors duration-700',
          reveal ? 'bg-success/[0.10]' : 'bg-amber-500/[0.06]'
        )}
      />

      {/* The game itself */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-5">
          <span className="font-heading text-4xl font-extrabold tracking-wide text-primary">
            LOOP TRIVIA
          </span>
          {/* Live dot — a small constant heartbeat that says the screen isn't a
              static poster, even while a question sits still. */}
          <span className="relative flex size-3.5">
            <span className="lm-ping absolute inline-flex size-full rounded-full bg-primary/70" />
            <span className="relative inline-flex size-3.5 rounded-full bg-primary" />
          </span>
          {live && (
            // Flex with a gap rather than text + spaces: the animated counters are
            // inline-block, and inter-element whitespace around them is not reliable.
            <span
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-5 py-1.5 text-2xl tabular-nums text-white/70 transition-colors duration-500',
                urgent ? 'border-red-400/40 bg-red-500/10' : 'border-white/15 bg-white/5'
              )}
            >
              <span>{reveal ? 'Answer' : 'Time left'}</span>
              <span
                key={secs}
                className={cn('lm-tick font-bold', timeColor, urgent && 'lm-urgent')}
              >
                {secs}s
              </span>
              {!reveal && (
                // What the question is worth RIGHT NOW, falling every second. This is
                // the hook for someone who hasn't joined: the screen is visibly
                // handing out fewer points the longer they sit there.
                <>
                  <span className="mx-1 text-white/25">|</span>
                  <span key={`w${worth}`} className="lm-tick font-bold text-white">
                    {worth.toLocaleString()}
                  </span>
                  <span className="text-white/50">pts</span>
                </>
              )}
            </span>
          )}
        </div>

        {live ? (
          // Keyed on the round so every new question replays the entrance animation —
          // the screen visibly RESETS between questions instead of quietly swapping text.
          <div key={live.round}>
            <div className="lm-rise mt-7 font-heading text-7xl font-extrabold leading-[1.06]">
              {live.prompt}
            </div>
            <div className="mt-9 grid grid-cols-2 gap-5">
              {live.choices.map((c, i) => {
                const right = reveal && live.correctIdx === i
                return (
                  <div
                    key={i}
                    // Staggered so the four choices deal in like cards rather than
                    // appearing as a block.
                    style={{ animationDelay: `${140 + i * 110}ms` }}
                    className={cn(
                      'lm-rise flex items-center gap-5 rounded-2xl border px-7 py-6 transition-all duration-500',
                      right
                        ? 'lm-pop border-success bg-success/20 shadow-[0_0_60px_-10px] shadow-success/60'
                        : reveal
                          ? 'border-white/10 bg-white/[0.02] opacity-40'
                          : 'border-white/15 bg-white/[0.06]'
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-14 shrink-0 items-center justify-center rounded-xl text-3xl font-bold transition-colors duration-500',
                        right ? 'bg-success text-black' : 'bg-white/10 text-white/70'
                      )}
                    >
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span className="min-w-0 truncate text-4xl">{c}</span>
                  </div>
                )
              })}
            </div>
            {/* Time bar — visibly draining, and it changes color as the clock gets
                short, so a rollover reads as the game advancing, not a glitch. */}
            <div className="mt-8 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={cn(
                  'h-full rounded-full transition-[width,background-color] duration-300 ease-linear',
                  barColor,
                  urgent && 'lm-urgent'
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ) : (
          // No live question yet (state still loading, or no questions configured
          // for this venue) — fall back to the invitation so the slide is never blank.
          <>
            <div className="lm-rise mt-7 font-heading text-6xl font-extrabold leading-tight">
              Trivia night,
              <br />
              <span className="text-primary">live on your phone.</span>
            </div>
            <div className="mt-6 text-3xl text-white/60">
              Answer from your seat and climb this week&apos;s leaderboard.
            </div>
          </>
        )}
      </div>

      {/* Join QR + this week's standings */}
      <div className="relative z-10 flex w-[24rem] shrink-0 flex-col items-center">
        {qrImage && (
          <div className="relative">
            {/* Slow breathing halo behind the QR — the one thing on screen we want
                someone to actually act on. */}
            <div
              aria-hidden
              className="lm-breathe absolute inset-0 rounded-2xl bg-primary/30 blur-xl"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrImage}
              alt="Scan to play"
              className="relative size-64 rounded-2xl bg-white p-3"
            />
          </div>
        )}
        <div className="mt-5 text-center text-3xl font-semibold text-white/85">
          Scan to play <span className="text-primary">free</span>
        </div>
        <div className="mt-2 text-center text-xl text-white/50">Fastest answer wins the most</div>
        <div className="mt-7 w-full">
          <div className="text-sm uppercase tracking-[0.2em] text-white/40">
            This Week&apos;s Leaders
          </div>
          {lb.length ? (
            <ol className="mt-3 space-y-1.5">
              {lb.slice(0, 3).map((p, i) => (
                <li
                  key={i}
                  style={{ animationDelay: `${300 + i * 120}ms` }}
                  className="lm-rise flex justify-between text-2xl"
                >
                  <span className="min-w-0 truncate">
                    <span className={cn(i === 0 && 'text-primary')}>{i + 1}.</span> {p.name}
                  </span>
                  <span className="ml-3 shrink-0 font-mono text-primary">
                    {p.score.toLocaleString()}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="mt-3 text-2xl text-white/50">Be the first to play!</div>
          )}
        </div>
      </div>
    </div>
  )
}

// The Jville Brew Loop house ad — a real two-column advertisement (brand + hook on
// the left, the $5-off offer + scannable QR on the right) rather than a logo
// dropped on a card. Uses the TRANSPARENT round badge so nothing renders as a
// black block. Brand voice: shared shuttle, "friends", no alcohol/DUI angle.
function BrewLoopAd({ qrImage }: { qrImage: string }) {
  // The idea is the loop itself: a route that never stops circling, with stops
  // lighting up one after another. A logo sitting next to a headline reads like
  // every other slide on every other bar TV — a moving route reads like the thing
  // it's selling. Black + gold only (brand), shared shuttle, no drink angle.
  const stops = [0, 60, 120, 180, 240, 300]
  return (
    <div className="relative flex h-full w-full items-center overflow-hidden bg-[#0a0a0b] px-20 text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 -left-40 size-[42rem] -translate-y-1/2 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative z-10 max-w-3xl">
        <div className="flex items-center gap-5">
          <Image
            src="/brewloop-badge.png"
            alt="Jville Brew Loop"
            width={1024}
            height={1024}
            priority
            className="size-24 drop-shadow-[0_0_30px_rgba(212,163,51,0.35)]"
          />
          <span className="text-2xl font-semibold uppercase tracking-[0.28em] text-primary/80">
            Jville Brew Loop
          </span>
        </div>
        <div className="mt-8 font-heading text-[7.5rem] font-black leading-[0.86] tracking-tight">
          RIDE
          <br />
          <span className="text-primary">ALL NIGHT.</span>
        </div>
        <div className="mt-7 max-w-xl text-3xl leading-snug text-white/70">
          One ticket, one shuttle, looping between town&apos;s best local spots with your
          friends. Hop on, hop off, all night long.
        </div>
        <div className="mt-9 inline-flex items-center gap-5 rounded-2xl border border-primary/40 bg-primary/10 px-8 py-4">
          <span className="font-heading text-6xl font-black leading-none text-primary">$5 OFF</span>
          <span className="text-2xl leading-tight text-white/80">
            your first ride
            <br />
            <span className="font-mono font-bold text-white">LOOP5</span>
          </span>
        </div>
      </div>

      {/* The route, with the QR at its hub. A dashed ring on a slow rotate and stop
          pins firing in sequence — cheap to composite (one transform each) and it
          never stops moving, which is the point on a screen people only glance at. */}
      <div className="relative z-10 ml-auto flex size-[40rem] shrink-0 items-center justify-center">
        <div aria-hidden className="lm-spin absolute inset-0">
          <svg viewBox="0 0 100 100" className="size-full">
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke="var(--color-primary)"
              strokeOpacity="0.4"
              strokeWidth="0.5"
              strokeDasharray="3 2.4"
            />
          </svg>
          {stops.map((deg, i) => (
            <div
              key={deg}
              className="absolute left-1/2 top-1/2 size-4"
              style={{ transform: `rotate(${deg}deg) translate(-50%, -18.4rem)` }}
            >
              <span
                className="lm-stop block size-4 rounded-full bg-primary"
                style={{ animationDelay: `${i * 400}ms` }}
              />
            </div>
          ))}
        </div>
        {qrImage && (
          <div className="relative flex flex-col items-center">
            <div className="relative">
              <div
                aria-hidden
                className="lm-breathe absolute inset-0 rounded-3xl bg-primary/30 blur-xl"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrImage}
                alt="Scan to book"
                className="relative size-64 rounded-3xl bg-white p-4 ring-4 ring-primary"
              />
            </div>
            <div className="mt-5 text-center text-2xl text-white/75">Scan to book</div>
          </div>
        )}
      </div>
    </div>
  )
}

// The "advertise on this screen" house ad. The slide IS the demo: it shows an
// empty ad frame where a real spot would run, so a business owner watching sees
// exactly what they'd be buying — the screen selling the screen. That beats a logo
// beside a headline, which is what every other house card in every other bar looks
// like. The frame's brackets and caret keep it alive between ads.
function AdvertiseAd({ qrImage }: { qrImage: string }) {
  return (
    <div className="relative flex h-full w-full items-center gap-16 overflow-hidden bg-[#0a0908] px-16 text-white">
      {/* Slow light sweep across the whole field. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="lm-sweep absolute -inset-y-40 -left-1/3 w-1/3 rotate-12 bg-gradient-to-r from-transparent via-primary/[0.07] to-transparent" />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-0 size-[40rem] rounded-full bg-primary/10 blur-3xl"
      />

      {/* The empty spot */}
      <div className="relative z-10 flex-1">
        <div className="relative aspect-[16/9] w-full rounded-2xl border-2 border-dashed border-primary/35 bg-white/[0.02]">
          {/* corner brackets */}
          {[
            'left-0 top-0 border-l-4 border-t-4 rounded-tl-2xl',
            'right-0 top-0 border-r-4 border-t-4 rounded-tr-2xl',
            'left-0 bottom-0 border-b-4 border-l-4 rounded-bl-2xl',
            'right-0 bottom-0 border-b-4 border-r-4 rounded-br-2xl',
          ].map((pos, i) => (
            <span
              key={i}
              aria-hidden
              className={cn('lm-bracket absolute size-16 border-primary', pos)}
              style={{ animationDelay: `${i * 180}ms` }}
            />
          ))}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="font-heading text-6xl font-black tracking-tight text-white/85">
              YOUR AD HERE
              <span className="lm-caret ml-2 inline-block h-12 w-2 translate-y-1 bg-primary align-middle" />
            </div>
            <div className="mt-4 text-2xl text-white/45">This spot is open</div>
            <div className="mt-10 text-xl uppercase tracking-[0.25em] text-primary/70">
              Plays every few minutes &middot; all night
            </div>
          </div>
        </div>
      </div>

      {/* The pitch */}
      <div className="relative z-10 flex w-[38rem] shrink-0 flex-col items-start">
        <Image
          src="/loop-network-logo.png"
          alt="Loop Network"
          width={1244}
          height={1244}
          priority
          className="w-40"
        />
        <div className="mt-6 font-heading text-6xl font-extrabold leading-[1.02]">
          Put your business
          <br />
          <span className="text-primary">on this screen.</span>
        </div>
        <div className="mt-5 text-3xl leading-snug text-white/70">
          Everyone in this room is already looking here.
        </div>
        {qrImage ? (
          <div className="mt-9 flex items-center gap-7">
            <div className="relative">
              <div aria-hidden className="lm-breathe absolute inset-0 rounded-2xl bg-primary/30 blur-xl" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrImage}
                alt="Scan to advertise"
                className="relative size-44 rounded-2xl bg-white p-3.5 ring-4 ring-primary"
              />
            </div>
            <div className="text-left">
              <div className="font-heading text-5xl font-extrabold text-primary">Claim it</div>
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

'use client'

import { forwardRef, useEffect, useRef, useState, type VideoHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

// A video creative rendered the way it airs on the TV: the video is CONTAINED
// (never cropped) on black, and when it isn't ~16:9 a blurred, object-cover copy
// of the SAME video fills behind it — so a portrait or odd-ratio clip looks
// full-screen instead of sitting in hard black bars. A true-16:9 video shows no
// backdrop (single decode — the common case pays nothing). The ref forwards to the
// FOREGROUND <video>, and all standard video props (muted/autoPlay/loop/playsInline,
// event handlers) pass through to it, so callers keep their playback/watchdog logic.
// Used on the TV (TvPlayer) and mirrored in every editor preview so preview == TV.
type Props = Omit<VideoHTMLAttributes<HTMLVideoElement>, 'src'> & {
  src: string
  containerClassName?: string
  /**
   * Fraction of the duration to park on if playback never starts (e.g. 0.35).
   *
   * A <video> with no poster paints its FIRST FRAME while paused, and ad
   * creatives routinely open on black because they animate in — of the three
   * videos running when this was written, one opened on near-black and one on
   * pure black. Anywhere autoplay doesn't run (iOS Low Power Mode, a background
   * tab, reduced-motion, a browser that just declines) those cards render as
   * empty rectangles, which is what "Archie's ad is blank" turned out to be.
   *
   * Only engages when the element is still paused shortly after mount, so the
   * normal autoplay path is untouched and viewers still see the ad from frame 0.
   * Omit it (as the TV player does) to keep stock behaviour.
   */
  pausedFrameAt?: number
  /**
   * Don't fetch the media until the element scrolls into view, then play it;
   * pause again on the way out.
   *
   * /playing renders every running ad at once — 29.5 MB of creatives when this
   * was written, 10.7 MB of it video. Fetched eagerly on a phone, the cards near
   * the bottom stay black for as long as the queue takes, which is what
   * "Archie's ad is blank" looked like: its 1.1 MB clip sitting behind a 7.4 MB
   * one. Off by default so the TV player, which must have the next spot buffered
   * before it airs, is unaffected.
   */
  playWhenVisible?: boolean
}

export const CreativeVideo = forwardRef<HTMLVideoElement, Props>(function CreativeVideo(
  {
    src,
    className,
    containerClassName,
    onLoadedMetadata,
    pausedFrameAt,
    playWhenVisible,
    ...rest
  },
  ref
) {
  // null = not measured yet (no backdrop until we know); false = ~16:9 (no backdrop);
  // true = off-ratio (show backdrop).
  const [offRatio, setOffRatio] = useState<boolean | null>(null)

  // Local handle on the foreground <video>. The forwarded `ref` may be a callback
  // or belong to a caller (TvPlayer keeps its own), so we can't read through it.
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (pausedFrameAt == null) return
    const v = videoRef.current
    if (!v) return

    let timer: ReturnType<typeof setTimeout> | undefined

    // Only armed once metadata exists. Waiting on a bare timer instead reads
    // duration as NaN whenever the browser hasn't fetched the header yet — which
    // is precisely the autoplay-blocked case this exists to fix — and then gives
    // up for good. Wait for the header, THEN decide.
    const arm = () => {
      clearTimeout(timer)
      // Give the browser a beat to honour autoplay before concluding it won't.
      // Too short and we seek a video that was about to play on its own.
      timer = setTimeout(() => {
        if (!v.paused || v.currentTime > 0) return
        const d = v.duration
        if (!Number.isFinite(d) || d <= 0) return
        try {
          v.currentTime = d * pausedFrameAt
        } catch {
          // Seeking can throw if the source was swapped mid-timeout. A black
          // card is the pre-existing behaviour, not a crash.
        }
      }, 500)
    }

    // readyState >= HAVE_METADATA means duration is already known.
    if (v.readyState >= 1) arm()
    else v.addEventListener('loadedmetadata', arm)

    return () => {
      clearTimeout(timer)
      v.removeEventListener('loadedmetadata', arm)
    }
  }, [src, pausedFrameAt])

  useEffect(() => {
    if (!playWhenVisible) return
    const v = videoRef.current
    if (!v) return

    // No IntersectionObserver (very old browser, some test envs) — fall back to
    // eager playback, i.e. exactly the behaviour before this existed.
    if (typeof IntersectionObserver === 'undefined') {
      v.play().catch(() => {})
      return
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // play() rejects when the browser declines autoplay (iOS Low Power
          // Mode). Swallow it — pausedFrameAt is what covers that case.
          v.play().catch(() => {})
        } else if (!v.paused) {
          v.pause()
        }
      },
      // Start a screen early so the spot is running by the time it's read, not
      // starting from black the instant it appears.
      { rootMargin: '200px 0px' }
    )
    io.observe(v)
    return () => io.disconnect()
  }, [src, playWhenVisible])

  return (
    <div className={cn('relative h-full w-full overflow-hidden bg-black', containerClassName)}>
      {offRatio === true && (
        <video
          src={src}
          aria-hidden
          muted
          autoPlay
          loop
          playsInline
          className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-2xl"
        />
      )}
      <video
        ref={(node) => {
          videoRef.current = node
          // Keep the caller's ref working — TvPlayer drives playback through it.
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
        src={src}
        className={cn('relative h-full w-full object-contain', className)}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          if (v.videoWidth && v.videoHeight) {
            const ar = v.videoWidth / v.videoHeight
            setOffRatio(Math.abs(ar - 16 / 9) > 0.02)
          }
          onLoadedMetadata?.(e)
        }}
        {...rest}
        // AFTER {...rest} on purpose: these have to beat the caller's autoPlay.
        // Callers pass autoPlay unconditionally, and leaving it set would have
        // the browser fetch the whole clip immediately — the exact eager load
        // playWhenVisible exists to stop. The observer starts playback instead.
        {...(playWhenVisible ? { autoPlay: false } : {})}
        // 'metadata' fetches only the header (a few KB), which is enough to know
        // the duration for pausedFrameAt and to paint a frame, without pulling
        // megabytes for a card nobody has scrolled to.
        {...(pausedFrameAt != null || playWhenVisible
          ? { preload: 'metadata' as const }
          : {})}
      />
    </div>
  )
})

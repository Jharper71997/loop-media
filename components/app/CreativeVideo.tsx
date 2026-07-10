'use client'

import { forwardRef, useState, type VideoHTMLAttributes } from 'react'
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
}

export const CreativeVideo = forwardRef<HTMLVideoElement, Props>(function CreativeVideo(
  { src, className, containerClassName, onLoadedMetadata, ...rest },
  ref
) {
  // null = not measured yet (no backdrop until we know); false = ~16:9 (no backdrop);
  // true = off-ratio (show backdrop).
  const [offRatio, setOffRatio] = useState<boolean | null>(null)

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
        ref={ref}
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
      />
    </div>
  )
})

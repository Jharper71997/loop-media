'use client'

import { useEffect, useState } from 'react'
import { QR_SIZE_DEFAULT } from '@/lib/adCreative'
import { cn } from '@/lib/utils'
import { QrChip } from './QrChip'
import { CreativeVideo } from './CreativeVideo'

// The ad exactly as it appears on a TV: the creative in a 16:9 frame (letterboxed
// on black for images, blurred-backdrop for off-ratio video, matching TvPlayer),
// with the scan QR at its free-drag spot — qrX/qrY are the QR's CENTER and qrSize
// its WIDTH, all fractions of the frame, the same overlay math the TV renders.
export function AdScreenPreview({
  creativeUrl,
  creativeType,
  qrUrl,
  qrX = 0.9,
  qrY = 0.88,
  qrSize = QR_SIZE_DEFAULT,
  className,
  eager = false,
}: {
  creativeUrl: string | null
  creativeType: 'video' | 'image'
  qrUrl?: string | null
  qrX?: number
  qrY?: number
  qrSize?: number
  className?: string
  /**
   * Load this creative immediately instead of when it scrolls into view.
   *
   * Set it for the ONE preview that is above the fold (the home page hero) so it
   * isn't deferred; leave it off everywhere else. /playing renders every running
   * ad, which was 29.5 MB of creatives fetched at once — enough that cards down
   * the page showed black until their turn in the queue came up.
   */
  eager?: boolean
}) {
  const [qr, setQr] = useState<string | null>(null)
  useEffect(() => {
    const u = (qrUrl ?? '').trim()
    if (!u) {
      setQr(null)
      return
    }
    let alive = true
    import('qrcode')
      .then(({ default: QR }) =>
        QR.toDataURL(u, { margin: 1, width: 240, color: { dark: '#000000', light: '#ffffff' } })
      )
      .then((d) => {
        if (alive) setQr(d)
      })
      .catch(() => {
        if (alive) setQr(null)
      })
    return () => {
      alive = false
    }
  }, [qrUrl])

  return (
    <div
      className={cn(
        'relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-foreground/10',
        className
      )}
    >
      {creativeUrl ? (
        creativeType === 'video' ? (
          // pausedFrameAt: ad creatives animate in, so frame 0 is often black.
          // If autoplay doesn't run, park a third of the way in — by then every
          // spot has its headline and logo up. The TV player renders CreativeVideo
          // directly and never passes either of these, so playback there is
          // unchanged.
          <CreativeVideo
            src={creativeUrl}
            muted
            autoPlay
            loop
            playsInline
            pausedFrameAt={0.35}
            playWhenVisible={!eager}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={creativeUrl}
            alt="Your ad"
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            className="h-full w-full object-contain"
          />
        )
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
          Creative in production
        </div>
      )}
      {qrUrl && qrUrl.trim() && <QrChip src={qr} x={qrX} y={qrY} size={qrSize} />}
    </div>
  )
}

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
}: {
  creativeUrl: string | null
  creativeType: 'video' | 'image'
  qrUrl?: string | null
  qrX?: number
  qrY?: number
  qrSize?: number
  className?: string
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
          <CreativeVideo src={creativeUrl} muted autoPlay loop playsInline />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={creativeUrl} alt="Your ad" className="h-full w-full object-contain" />
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

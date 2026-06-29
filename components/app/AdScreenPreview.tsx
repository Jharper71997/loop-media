'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { QrPosition } from '@/lib/db.types'

// The ad exactly as it appears on a TV: creative in a 16:9 frame, letterboxed,
// with the scan QR in its chosen corner — the same layout the TV player renders.
const CORNER: Record<QrPosition, string> = {
  'top-left': 'left-2 top-2',
  'top-right': 'right-2 top-2',
  'bottom-left': 'left-2 bottom-2',
  'bottom-right': 'right-2 bottom-2',
}

export function AdScreenPreview({
  creativeUrl,
  creativeType,
  qrUrl,
  qrPosition = 'bottom-right',
  className,
}: {
  creativeUrl: string | null
  creativeType: 'video' | 'image'
  qrUrl?: string | null
  qrPosition?: QrPosition
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
          <video
            src={creativeUrl}
            className="h-full w-full object-contain"
            muted
            autoPlay
            loop
            playsInline
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={creativeUrl} alt="Your ad" className="h-full w-full object-contain" />
        )
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
          Creative in production
        </div>
      )}
      {qrUrl && qrUrl.trim() && (
        <div
          className={cn(
            'absolute rounded-md bg-white p-1 ring-2 ring-[#d4af37]',
            CORNER[qrPosition]
          )}
        >
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="Scan" className="size-10 rounded-sm sm:size-12" />
          ) : (
            <div className="size-10 rounded-sm bg-muted sm:size-12" />
          )}
        </div>
      )}
    </div>
  )
}

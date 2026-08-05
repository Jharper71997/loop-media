import { MonitorPlay } from 'lucide-react'
import { AdScreenPreview } from '@/components/app/AdScreenPreview'
import type { LiveAd } from '@/lib/liveAds'
import { cn } from '@/lib/utils'
import { TvFrame } from './TvFrame'

// One real, currently-running ad shown the way it actually airs — same
// AdScreenPreview render the TV player and the advertiser's own dashboard use,
// so this is the ad, not an illustration of one.
export function LiveAdCard({
  ad,
  stand = false,
  className,
}: {
  ad: LiveAd
  stand?: boolean
  className?: string
}) {
  return (
    <figure className={cn('space-y-3', className)}>
      <TvFrame stand={stand}>
        <AdScreenPreview
          creativeUrl={ad.creativeUrl}
          creativeType={ad.creativeType}
          qrUrl={ad.qrUrl}
          className="rounded-none ring-0"
        />
      </TvFrame>
      <figcaption className="space-y-0.5 px-0.5">
        <p className="truncate text-sm font-semibold">{ad.title}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MonitorPlay className="size-3.5 shrink-0 text-primary" />
          Running on {ad.venues} {ad.venues === 1 ? 'screen' : 'screens'}
          {ad.category && <span className="truncate"> · {ad.category}</span>}
        </p>
      </figcaption>
    </figure>
  )
}

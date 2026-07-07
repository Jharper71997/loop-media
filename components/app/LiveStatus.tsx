import { isTvLive } from '@/lib/format'
import { cn } from '@/lib/utils'

// Truthful screen status from heartbeat freshness (not the stale `status` enum):
// Not paired → Offline → Live (pulsing). Optionally shows how many ads are
// currently running on the screen.
export function LiveStatus({
  lastHeartbeat,
  paired,
  adsRunning,
  className,
}: {
  lastHeartbeat: string | null
  paired: boolean
  adsRunning?: number
  className?: string
}) {
  if (!paired) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning',
          className
        )}
      >
        <span className="size-2 rounded-full bg-warning" /> Not paired
      </span>
    )
  }
  const live = isTvLive(lastHeartbeat)
  if (live) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success',
          className
        )}
      >
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
        Live
        {typeof adsRunning === 'number' && (
          <span className="text-success/80">
            · {adsRunning} ad{adsRunning === 1 ? '' : 's'}
          </span>
        )}
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground',
        className
      )}
    >
      <span className="size-2 rounded-full bg-muted-foreground" /> Offline
    </span>
  )
}

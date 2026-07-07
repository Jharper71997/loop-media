import { cn } from '@/lib/utils'

function Block({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-muted/60', className)} />
}

// Skeleton mirroring the host dashboard (header + 4 stat tiles + venue cards) so
// its several sequential queries don't flash a blank screen on navigation.
export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <Block className="h-8 w-40" />
        <Block className="h-9 w-40" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Block className="h-20" />
        <Block className="h-20" />
        <Block className="h-20" />
        <Block className="h-20" />
      </div>
      <div className="space-y-4">
        <Block className="h-32" />
        <Block className="h-32" />
      </div>
    </div>
  )
}

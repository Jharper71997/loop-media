import { cn } from '@/lib/utils'

function Block({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-muted/60', className)} />
}

// Skeleton mirroring the advertiser dashboard so navigation doesn't read as a hang.
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Block className="h-8 w-40" />
        <Block className="h-8 w-16" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Block className="h-20" />
        <Block className="h-20" />
        <Block className="h-20" />
        <Block className="h-20" />
      </div>
      <Block className="h-6 w-48" />
      <div className="space-y-3">
        <Block className="h-16" />
        <Block className="h-16" />
        <Block className="h-16" />
      </div>
    </div>
  )
}

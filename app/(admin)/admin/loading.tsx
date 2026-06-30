import { cn } from '@/lib/utils'

function Block({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-muted/60', className)} />
}

// Skeleton for the admin overview + its heavier sub-pages (many sequential queries).
export default function Loading() {
  return (
    <div className="space-y-6">
      <Block className="h-8 w-52" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Block className="h-24" />
        <Block className="h-24" />
        <Block className="h-24" />
        <Block className="h-24" />
      </div>
      <Block className="h-64" />
    </div>
  )
}

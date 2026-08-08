import { cn } from '@/lib/utils'

function Block({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted/60', className)} />
}

// The skeleton every admin route shows while its data loads.
//
// It used to be shaped like the old Today page — a title and four floating
// cards in a gapped grid — which matched no page in the admin any more, so
// every click flashed a layout that then rearranged into something else. That
// reads as slower than it is, because the eye tracks the jump rather than the
// wait.
//
// This is the shape almost every page now shares: a sticky header band, a tab
// strip, a toolbar, and rows. It resolves into a real page instead of being
// replaced by one.
export default function Loading() {
  return (
    <>
      <div className="border-b border-border px-3 py-2.5 md:px-4">
        <Block className="h-5 w-40" />
        <Block className="mt-1.5 h-3 w-56" />
      </div>
      <div className="flex gap-3 border-b border-border px-3 py-2 md:px-4">
        {['w-16', 'w-12', 'w-20', 'w-14'].map((w, i) => (
          <Block key={i} className={cn('h-3.5', w)} />
        ))}
      </div>
      <div className="space-y-3 p-3 md:p-4">
        <div className="flex gap-2">
          <Block className="h-9 flex-1" />
          <Block className="h-9 w-28" />
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-0">
              <Block className="size-4 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Block className="h-3.5 w-1/3" />
                <Block className="h-2.5 w-1/2" />
              </div>
              <Block className="h-3.5 w-16 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

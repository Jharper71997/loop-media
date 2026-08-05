import { cn } from '@/lib/utils'

// A physical TV around a 16:9 screen: bezel, neck, foot. Used all over the public
// site so an ad always reads as "on a television in a room", not as a web banner.
// The screen area is ALWAYS black regardless of theme — that's what a real panel
// showing letterboxed creative looks like, and the bright site needs the contrast.
export function TvFrame({
  children,
  stand = true,
  className,
  screenClassName,
}: {
  children: React.ReactNode
  stand?: boolean
  className?: string
  screenClassName?: string
}) {
  return (
    <div className={cn('flex flex-col items-center', className)}>
      <div className="w-full rounded-[1.1rem] bg-neutral-900 p-2 shadow-xl shadow-black/20 ring-1 ring-black/10 sm:rounded-[1.4rem] sm:p-3">
        <div className={cn('overflow-hidden rounded-lg bg-black', screenClassName)}>{children}</div>
      </div>
      {stand && (
        <>
          <div className="h-3 w-10 rounded-b-md bg-neutral-800 sm:h-4 sm:w-14" />
          <div className="h-1.5 w-24 rounded-full bg-neutral-800/80 sm:w-32" />
        </>
      )}
    </div>
  )
}

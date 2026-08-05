import Link from 'next/link'
import { cn } from '@/lib/utils'

// The HUD shell: the frame every admin page is built out of.
//
// The brief was "everything on one screen, least scrolling". That is a spacing
// problem, not a colour problem, so the rules here are about density:
//
//   - Panels touch. Stats in a strip share hairlines instead of floating as
//     separate cards with a gutter between them — a 1px rule costs 1px, a card
//     gap costs 16 and there are five of them per row.
//   - Numbers are mono (--font-mono) and tabular. In a cockpit you scan a column
//     of figures for the one that changed, and that only works if digits are the
//     same width down the column.
//   - Labels are 10-11px uppercase. They are signposts you read once, not prose.
//
// Hairlines come from `gap-px` over a `bg-border` container rather than
// divide-x/border-r: the strip wraps to 2 columns on a phone and 6 on a desktop,
// and only the gap trick draws correct interior rules at every wrap point.

// ---------------------------------------------------------------------------
// HudBody — the page body. Tighter than a normal page on purpose.
// ---------------------------------------------------------------------------

export function HudBody({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn('space-y-3 p-3 md:p-4', className)}>{children}</div>
}

// ---------------------------------------------------------------------------
// StatStrip — the top band of numbers.
// ---------------------------------------------------------------------------

// Explicit class strings per column count: Tailwind scans source text, so a
// computed `grid-cols-${n}` would never be generated.
const STRIP_COLS: Record<number, string> = {
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
  6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
}

export function StatStrip({
  cols = 4,
  children,
  className,
}: {
  cols?: 3 | 4 | 5 | 6
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid gap-px overflow-hidden rounded-lg border border-border bg-border',
        STRIP_COLS[cols],
        className
      )}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stat — one cell of the strip. Optionally a link; the whole cell is the target.
// ---------------------------------------------------------------------------

export function Stat({
  label,
  value,
  sub,
  delta,
  href,
  tone,
  title,
}: {
  label: string
  value: string
  sub?: string
  delta?: React.ReactNode
  href?: string
  tone?: 'warn' | 'good' | 'bad'
  // Native tooltip for the definition behind the number.
  title?: string
}) {
  const body = (
    <>
      <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          'mt-0.5 truncate font-mono text-xl font-semibold tabular-nums tracking-tight',
          tone === 'warn' && 'text-warning',
          tone === 'good' && 'text-success',
          tone === 'bad' && 'text-destructive'
        )}
      >
        {value}
      </p>
      {delta}
      {sub && <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{sub}</p>}
    </>
  )

  const cls = 'min-w-0 bg-card px-3 py-2.5'
  if (href) {
    return (
      <Link href={href} className={cn(cls, 'block transition-colors hover:bg-accent/60')} title={title}>
        {body}
      </Link>
    )
  }
  return (
    <div className={cls} title={title}>
      {body}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panel — the titled box. Everything that is not a stat lives in one.
// ---------------------------------------------------------------------------

export function Panel({
  title,
  note,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: string
  note?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn('flex flex-col rounded-lg border border-border bg-card', className)}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {action ?? (note && <span className="text-[11px] text-muted-foreground">{note}</span>)}
      </header>
      <div className={cn('min-h-0 flex-1 p-3', bodyClassName)}>{children}</div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Num — a figure in running text. Same treatment as a Stat value so a number
// reads as a number wherever it appears.
// ---------------------------------------------------------------------------

export function Num({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('font-mono tabular-nums', className)}>{children}</span>
}

// ---------------------------------------------------------------------------
// Scroll — a fixed-height scroll region inside a Panel.
//
// The point of the HUD is that the PAGE does not scroll; a long list scrolls
// inside its own panel so the panels below it stay on screen.
// ---------------------------------------------------------------------------

export function Scroll({
  max = 'max-h-72',
  children,
  className,
}: {
  max?: string
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn('overflow-y-auto', max, className)}>{children}</div>
}

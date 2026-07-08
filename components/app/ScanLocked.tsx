import { Lock } from 'lucide-react'

// QR scan analytics are moving to a separate "Insights" membership, which is not
// on sale yet. Until an advertiser holds that membership, every place a scan
// number would appear shows this locked "coming soon" placeholder instead.
//   tile   — fits a dashboard stat-tile slot (home, results)
//   stat   — fits a compact Stat cell (campaign detail, past campaigns)
//   panel  — replaces a whole scan section (results chart + top locations)
//   inline — a small muted note in a header/subtitle
export function ScanLocked({
  variant = 'tile',
  label = 'Scans',
}: {
  variant?: 'tile' | 'stat' | 'panel' | 'inline'
  label?: string
}) {
  if (variant === 'inline') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Lock className="size-3" /> Scans coming soon
      </span>
    )
  }

  if (variant === 'stat') {
    return (
      <div className="space-y-0.5">
        <p className="flex items-center gap-1.5 font-heading text-2xl font-bold text-muted-foreground">
          <Lock className="size-4" /> Soon
        </p>
        <p className="text-xs font-medium">{label}</p>
        <p className="text-[0.7rem] text-muted-foreground">coming soon</p>
      </div>
    )
  }

  if (variant === 'panel') {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
        <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-muted">
          <Lock className="size-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-semibold">QR scan analytics</p>
        <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
          Coming soon with Loop Insights. You&apos;ll see every scan your ad drives, by day and by
          location.
        </p>
      </div>
    )
  }

  // tile
  return (
    <div className="rounded-xl border border-border bg-card/60 px-4 py-3.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 font-heading text-lg font-bold text-muted-foreground">
        <Lock className="size-4" /> Coming soon
      </div>
    </div>
  )
}

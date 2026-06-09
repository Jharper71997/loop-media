import { cn } from '@/lib/utils'

// Big headline numeral. Use `metallic` for showpiece numbers (totals, hero stats).
export function MoneyStat({
  label,
  value,
  sub,
  metallic,
  className,
}: {
  label?: string
  value: string
  sub?: string
  metallic?: boolean
  className?: string
}) {
  return (
    <div className={className}>
      {label && (
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
      )}
      <div
        className={cn(
          'font-heading text-3xl font-bold tabular-nums leading-none',
          metallic && 'text-gold-metallic'
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

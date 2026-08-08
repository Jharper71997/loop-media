import { CheckCircle2, SearchX, type LucideIcon } from 'lucide-react'

// The admin had sixteen different empty-state markups — dashed boxes, bare
// paragraphs, table cells with colSpan, and one `<span>` — which is why nothing
// felt like it was built by the same person. This is the only one.
//
// It distinguishes the two cases that matter, because they need opposite
// reactions: "there is nothing here" is information, and "your filter matched
// nothing" is a dead end you want backing out of.

export function EmptyState({
  title,
  hint,
  icon: Icon,
  filtered,
  action,
}: {
  title: string
  hint?: string
  icon?: LucideIcon
  /** True when a filter is hiding rows that do exist. */
  filtered?: boolean
  action?: React.ReactNode
}) {
  const Glyph = Icon ?? (filtered ? SearchX : CheckCircle2)
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
      <Glyph className={'size-6 ' + (filtered ? 'text-muted-foreground' : 'text-success')} />
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

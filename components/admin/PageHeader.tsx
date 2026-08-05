// The header band. Deliberately short: it is sticky, so every pixel it takes is
// a pixel of data that never gets to be on screen. Title on the same baseline as
// its description rather than stacked, which saves a whole line.
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="z-30 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border bg-background/85 px-3 py-2.5 backdrop-blur md:sticky md:top-0 md:px-4">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <h1 className="font-heading text-base font-bold tracking-tight md:text-lg">{title}</h1>
        {description && (
          <p className="min-w-0 truncate text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}

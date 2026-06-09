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
    <div className="z-30 flex flex-wrap items-end justify-between gap-3 border-b border-border bg-background/85 px-5 py-4 backdrop-blur md:sticky md:top-0 md:px-6 md:py-5">
      <div>
        <h1 className="font-heading text-xl font-bold tracking-tight md:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

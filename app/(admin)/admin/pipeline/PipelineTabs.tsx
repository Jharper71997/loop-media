'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { KIND_LABEL, type OpportunityKind } from '@/lib/pipeline'

// Board / Dashboard, plus which pipeline you are looking at.
//
// Not SectionTabs: that component lights any tab whose href is a prefix of the
// current path, so "/admin/pipeline" would stay lit on the dashboard too. The
// board tab needs an exact match.

export function PipelineTabs({ kind }: { kind: OpportunityKind }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const range = params.get('range')
  const onDashboard = pathname.startsWith('/admin/pipeline/dashboard')

  const suffix = (k: OpportunityKind) =>
    `?kind=${k}${range && onDashboard ? `&range=${range}` : ''}`

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1.5 md:px-4">
      <div className="flex gap-1">
        <Tab href={`/admin/pipeline${suffix(kind)}`} active={!onDashboard}>
          Board
        </Tab>
        <Tab href={`/admin/pipeline/dashboard${suffix(kind)}`} active={onDashboard}>
          Dashboard
        </Tab>
      </div>

      <div className="flex gap-1">
        {(['advertiser', 'host'] as OpportunityKind[]).map((k) => (
          <Tab
            key={k}
            href={`${onDashboard ? '/admin/pipeline/dashboard' : '/admin/pipeline'}${suffix(k)}`}
            active={k === kind}
          >
            {KIND_LABEL[k]}
          </Tab>
        ))}
      </div>
    </div>
  )
}

function Tab({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-md px-2.5 py-1 text-xs transition-colors',
        active
          ? 'bg-primary/10 font-medium text-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
      {children}
    </Link>
  )
}

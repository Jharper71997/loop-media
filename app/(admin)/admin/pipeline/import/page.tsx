import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { PageHeader } from '@/components/admin/PageHeader'
import { HudBody } from '@/components/admin/hud'
import { ImportForm } from './ImportForm'
import type { OpportunityKind } from '@/lib/pipeline'

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>
}) {
  await requireAdmin()
  const { kind } = await searchParams
  const defaultKind: OpportunityKind = kind === 'host' ? 'host' : 'advertiser'

  return (
    <>
      <PageHeader
        title="Import prospects"
        description="Paste a list and it becomes cards on the board"
      />
      <HudBody>
        <Link
          href={`/admin/pipeline?kind=${defaultKind}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back to pipeline
        </Link>
        <ImportForm defaultKind={defaultKind} />
      </HudBody>
    </>
  )
}

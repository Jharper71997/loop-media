import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, SHIP_TABS } from '@/components/admin/SectionTabs'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/format'
import type { CreativeRequestStatus } from '@/lib/db.types'
import { CreativeActions } from './CreativeActions'

export const dynamic = 'force-dynamic'

type CreativeRow = {
  id: string
  brief: string
  status: CreativeRequestStatus
  admin_note: string | null
  created_at: string
  updated_at: string | null
  advertiser: { full_name: string | null; email: string } | null
}

const STATUS_LABEL: Record<CreativeRequestStatus, string> = {
  open: 'New',
  in_progress: 'In progress',
  done: 'Done',
}

export default async function CreativeQueuePage() {
  await requireAdmin()
  const supabase = await createClient()

  // creative_requests has no territory column (an advertiser is not bound to
  // one), so this queue is global to all admins. Open work first, done last.
  const { data } = await supabase
    .from('creative_requests')
    .select('id, brief, status, admin_note, created_at, updated_at, advertiser:profiles!advertiser_id(full_name, email)')
    .order('created_at', { ascending: false })
  const rows = (data ?? []) as unknown as CreativeRow[]

  const rank: Record<CreativeRequestStatus, number> = { open: 0, in_progress: 1, done: 2 }
  rows.sort((a, b) => rank[a.status] - rank[b.status])
  const openCount = rows.filter((r) => r.status !== 'done').length

  return (
    <>
      <PageHeader
        title="Creative help"
        description={`${openCount} request${openCount === 1 ? '' : 's'} to work. Advertisers who asked us to build their ad.`}
      />
      <SectionTabs tabs={SHIP_TABS} />

      <div className="space-y-3 p-3 md:p-4">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center text-muted-foreground">
            No creative-help requests yet.
          </div>
        ) : (
          rows.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-border bg-card p-4 md:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={r.status === 'done' ? 'outline' : r.status === 'in_progress' ? 'default' : 'secondary'}
                    >
                      {STATUS_LABEL[r.status]}
                    </Badge>
                    <span className="text-sm font-medium">
                      {r.advertiser?.full_name ?? r.advertiser?.email ?? 'Unknown advertiser'}
                    </span>
                  </div>
                  {r.advertiser?.email && (
                    <a
                      href={`mailto:${r.advertiser.email}`}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {r.advertiser.email}
                    </a>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">{formatDateTime(r.created_at)}</span>
              </div>

              <p className="mt-3 whitespace-pre-wrap rounded-lg bg-background/60 p-3 text-sm">
                {r.brief}
              </p>

              <div className="mt-4 border-t border-border pt-4">
                <CreativeActions id={r.id} status={r.status} note={r.admin_note} />
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}

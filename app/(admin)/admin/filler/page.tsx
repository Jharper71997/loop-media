import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { DeleteButton } from '@/components/admin/DeleteButton'
import { Badge } from '@/components/ui/badge'
import { FillerDialog } from './FillerDialog'
import { FillerToggle } from './FillerToggle'
import { deleteFiller, type FillerType } from './actions'

export const dynamic = 'force-dynamic'

const TYPE_LABELS: Record<string, string> = {
  trivia: 'Trivia',
  event: 'Local event',
  sports: 'Game day',
  promo: 'Featured',
  weather: 'Weather',
}

type FillerRow = {
  id: string
  type: FillerType
  payload: { headline?: string; sub?: string; foot?: string; auto?: boolean }
  active: boolean
  expires_at: string | null
}

export default async function FillerPage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  let rows: FillerRow[] = []
  if (t) {
    const { data } = await supabase
      .from('filler_content')
      .select('id, type, payload, active, expires_at')
      .eq('territory_id', t)
      .order('created_at', { ascending: false })
    rows = (data ?? []) as FillerRow[]
  }

  return (
    <>
      <PageHeader
        title="Filler cards"
        description="Trivia, local events and notes that play between ads on every screen in this territory"
        action={<FillerDialog territoryId={t ?? ''} />}
      />

      <div className="space-y-3 p-5 md:p-6">
        {!t && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            Pick a single territory in the sidebar to author its filler cards.
          </div>
        )}

        {t && rows.length === 0 && (
          <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            No filler cards yet. Add trivia or a local event to fill the gaps between ads.
          </div>
        )}

        {rows.map((r) => {
          const expired = r.expires_at && new Date(r.expires_at).getTime() < Date.now()
          const auto = r.payload.auto === true
          return (
            <div
              key={r.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{TYPE_LABELS[r.type] ?? r.type}</Badge>
                  {auto && <Badge variant="outline">Auto</Badge>}
                  {!r.active && <Badge variant="outline">Paused</Badge>}
                  {expired && <Badge variant="outline">Expired</Badge>}
                </div>
                <p className="mt-2 font-medium">{r.payload.headline ?? '—'}</p>
                {r.payload.sub && <p className="text-sm text-muted-foreground">{r.payload.sub}</p>}
                {r.payload.foot && (
                  <p className="text-xs text-muted-foreground/70">{r.payload.foot}</p>
                )}
                {r.expires_at && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Expires {new Date(r.expires_at).toLocaleDateString('en-US')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                {!auto && (
                  <FillerDialog
                    territoryId={t ?? ''}
                    existing={{
                      id: r.id,
                      type: r.type as FillerType,
                      headline: r.payload.headline ?? '',
                      sub: r.payload.sub ?? '',
                      foot: r.payload.foot ?? '',
                      expires_at: r.expires_at,
                    }}
                  />
                )}
                <FillerToggle id={r.id} active={r.active} />
                <DeleteButton id={r.id} action={deleteFiller} />
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

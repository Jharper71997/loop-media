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

// "Trivia card" is the static between-ad card — distinct from the phone-played
// Trivia game (its own admin section). The label spells that out to avoid the
// naming collision.
const TYPE_LABELS: Record<string, string> = {
  trivia: 'Trivia card',
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
  territory: { name: string } | null
}

export default async function FillerPage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  // Consistent with the rest of admin: "All markets" shows every territory's
  // cards (read-only labels), and the switcher scopes to one. Authoring still
  // targets a specific territory, so the Add button only appears with one active.
  let fq = supabase
    .from('filler_content')
    .select('id, type, payload, active, expires_at, territory:territories(name)')
    .order('created_at', { ascending: false })
  if (t) fq = fq.eq('territory_id', t)
  const { data } = await fq
  const rows = (data ?? []) as unknown as FillerRow[]

  return (
    <>
      <PageHeader
        title="Filler cards"
        description={
          t
            ? 'Cards that play between ads on every screen in this market'
            : 'Cards that play between ads — across all markets. Pick a market to add one.'
        }
        action={t ? <FillerDialog territoryId={t} /> : undefined}
      />

      <div className="space-y-3 p-5 md:p-6">
        {rows.length === 0 && (
          <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            {t
              ? 'No filler cards yet. Add trivia or a local event to fill the gaps between ads.'
              : 'No filler cards in any market yet.'}
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
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{TYPE_LABELS[r.type] ?? r.type}</Badge>
                  {!t && r.territory?.name && <Badge variant="outline">{r.territory.name}</Badge>}
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
                {!auto && t && (
                  <FillerDialog
                    territoryId={t}
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

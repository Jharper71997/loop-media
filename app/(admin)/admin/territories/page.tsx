import { requireAdmin, isGlobalAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { territoryUsage, usageSummary } from '@/lib/territory'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, MORE_TABS } from '@/components/admin/SectionTabs'
import { HudBody, Panel } from '@/components/admin/hud'
import { Badge } from '@/components/ui/badge'
import type { Territory } from '@/lib/db.types'
import { NewTerritory } from './NewTerritory'
import { TerritoryRowActions } from './TerritoryRowActions'

export const dynamic = 'force-dynamic'

// Markets — the list every other page is scoped by.
//
// Until now the only way to get one was for a host to register a venue in a city
// we did not have yet (findOrCreateTerritory), which meant a typo in that form
// became a permanent market in the switcher and there was no way to take it out.
export default async function TerritoriesPage() {
  const profile = await requireAdmin()
  const canEdit = isGlobalAdmin(profile)
  const supabase = await createClient()

  const { data } = await supabase
    .from('territories')
    .select('*')
    .order('is_holding')
    .order('name')
  const territories = (data ?? []) as Territory[]
  const usage = await territoryUsage(territories.map((t) => t.id))

  return (
    <>
      <PageHeader
        title="Markets"
        description="The cities the network runs in. Everything else on the network is scoped to one of these."
      />
      <SectionTabs tabs={MORE_TABS} />
      <HudBody>
        <Panel
          title="Markets"
          action={
            canEdit ? (
              <NewTerritory />
            ) : (
              <span className="text-[11px] text-muted-foreground">
                Your access is scoped to one market
              </span>
            )
          }
          bodyClassName="p-0"
        >
          {territories.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No markets yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {territories.map((t) => {
                const u = usage.get(t.id)
                const blockers = u ? usageSummary(u) : ''
                return (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{t.name}</span>
                        {t.is_holding && <Badge variant="outline">Parent company</Badge>}
                        {t.status === 'inactive' && <Badge variant="secondary">Archived</Badge>}
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {t.timezone}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t.is_holding
                          ? 'Sits above the city markets. Nothing is sold in it.'
                          : blockers
                            ? `Holds ${blockers}.`
                            : 'Nothing in it yet — safe to delete.'}
                      </p>
                    </div>
                    {canEdit && !t.is_holding && (
                      <TerritoryRowActions
                        id={t.id}
                        name={t.name}
                        status={t.status}
                        blockers={blockers}
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        <p className="text-xs text-muted-foreground">
          A market is also created on its own when a host registers a venue in a city the network
          has not reached yet, which is where a stray one usually comes from. Archiving keeps a
          market and its history but stops offering it: it drops out of the advertiser browse and
          no enquiry from the public site lands in it. Deleting is only possible while nothing
          points at it.
        </p>
      </HudBody>
    </>
  )
}

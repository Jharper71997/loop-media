import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { InlineNumber } from '@/components/admin/InlineNumber'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { Package } from '@/lib/db.types'
import { ActiveToggle } from './ActiveToggle'
import {
  setPackageScreenCap,
  setPackageGoal,
  setPackagePrice,
  setTerritoryPrice,
} from './actions'

export default async function PackagesPage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  const { data } = await supabase
    .from('packages')
    .select('*')
    .order('base_price_cents', { ascending: true })
  const packages = (data ?? []) as Package[]

  // Per-territory overrides for the active market.
  const overrideByPackage = new Map<string, number>()
  if (t && packages.length) {
    const { data: overrides } = await supabase
      .from('package_territory_prices')
      .select('package_id, price_cents')
      .eq('territory_id', t)
    for (const o of overrides ?? []) overrideByPackage.set(o.package_id, o.price_cents)
  }

  const activeName = territory.territories.find((x) => x.id === t)?.name

  return (
    <>
      <PageHeader
        title="Packages & pricing"
        description={
          t ? `Base prices + ${activeName} overrides` : 'Global package templates'
        }
      />

      <div className="space-y-4 p-6">
        {!t && (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            Select a single territory in the sidebar to set per-market price overrides.
          </p>
        )}

        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Package</TableHead>
                <TableHead>Screen cap</TableHead>
                <TableHead>Goal (impr/mo)</TableHead>
                <TableHead>Base price ($/mo)</TableHead>
                {t && <TableHead>{activeName} price ($/mo)</TableHead>}
                <TableHead className="text-right">Visibility</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {packages.length === 0 && (
                <TableRow>
                  <TableCell colSpan={t ? 6 : 5} className="py-10 text-center text-muted-foreground">
                    No packages yet.
                  </TableCell>
                </TableRow>
              )}
              {packages.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      <Badge variant="secondary" className="capitalize">
                        {p.tier}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <InlineNumber
                      initial={p.screen_cap}
                      allowEmpty
                      min={1}
                      placeholder="unlimited"
                      action={setPackageScreenCap.bind(null, p.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <InlineNumber
                      initial={p.target_impressions || null}
                      allowEmpty
                      min={0}
                      placeholder="0"
                      action={setPackageGoal.bind(null, p.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <InlineNumber
                      initial={p.base_price_cents / 100}
                      allowEmpty={false}
                      min={0}
                      action={setPackagePrice.bind(null, p.id)}
                    />
                  </TableCell>
                  {t && (
                    <TableCell>
                      <InlineNumber
                        initial={
                          overrideByPackage.has(p.id)
                            ? (overrideByPackage.get(p.id) as number) / 100
                            : null
                        }
                        allowEmpty
                        min={0}
                        placeholder="use base"
                        action={setTerritoryPrice.bind(null, p.id, t)}
                      />
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <ActiveToggle id={p.id} active={p.active} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  )
}

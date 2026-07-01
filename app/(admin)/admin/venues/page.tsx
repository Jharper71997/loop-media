import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { DeleteButton } from '@/components/admin/DeleteButton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { formatNumber, formatCents } from '@/lib/format'
import { suggestTier, tierPriceCents, TIER_LABEL } from '@/lib/pricing'
import { getPricingConfig } from '@/lib/pricing.server'
import { isVenueListable } from '@/lib/venue'
import type { Category, Territory, Venue, PriceTier } from '@/lib/db.types'
import { VenueDialog } from './VenueDialog'
import { VisibilityToggle } from './VisibilityToggle'
import { TriviaToggle } from './TriviaToggle'
import { deleteVenue } from './actions'
import { cn } from '@/lib/utils'

const venueTier = (v: { price_tier: PriceTier | null; foot_traffic_estimate: number }): PriceTier =>
  v.price_tier ?? suggestTier(v.foot_traffic_estimate)

type VenueRow = Venue & {
  category: { name: string } | null
  territory: { name: string } | null
}

export default async function VenuesPage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()
  const pricingConfig = await getPricingConfig()

  let vq = supabase
    .from('venues')
    .select('*, category:categories(name), territory:territories(name)')
    .order('name')
  if (t) vq = vq.eq('territory_id', t)

  const [{ data: venues }, { data: categories }, { data: hostProfiles }] = await Promise.all([
    vq,
    supabase.from('categories').select('*').order('name'),
    supabase.from('profiles').select('id, email, full_name').in('role', ['host', 'admin']).order('email'),
  ])

  const rows = (venues ?? []) as VenueRow[]
  const cats = (categories ?? []) as Category[]
  const territories = territory.territories as Territory[]
  const hosts = (hostProfiles ?? []) as { id: string; email: string; full_name: string | null }[]

  return (
    <>
      <PageHeader
        title="Venues"
        description={`${rows.length} location${rows.length === 1 ? '' : 's'}`}
        action={
          <VenueDialog
            categories={cats}
            territories={territories}
            hosts={hosts}
            defaultTerritoryId={t ?? ''}
            pricingConfig={pricingConfig}
          />
        }
      />

      <div className="p-5 md:p-6">
        {/* Mobile cards */}
        <div className="space-y-2.5 md:hidden">
          {rows.length === 0 && (
            <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              No venues yet. Add your first location.
            </p>
          )}
          {rows.map((v) => (
            <div
              key={v.id}
              className={cn(
                'rounded-xl border border-border bg-card p-4',
                v.status !== 'active' && 'opacity-50'
              )}
            >
              <Link href={`/admin/venues/${v.id}`} className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium hover:underline">{v.name}</div>
                  {v.venue_type && (
                    <div className="text-xs text-muted-foreground">{v.venue_type}</div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {v.status !== 'active' ? (
                    <Badge variant="secondary">Hidden</Badge>
                  ) : isVenueListable(v) ? (
                    <Badge>On map</Badge>
                  ) : (
                    <Badge variant="warning">
                      Needs data
                    </Badge>
                  )}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </div>
              </Link>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{v.category?.name ?? '—'}</span>
                {!t && <span>{v.territory?.name ?? '—'}</span>}
                <span>{formatNumber(v.foot_traffic_estimate)}/mo traffic</span>
                <span className="font-medium text-primary">
                  {TIER_LABEL[venueTier(v)]} · {formatCents(tierPriceCents(venueTier(v), pricingConfig))}/mo
                </span>
              </div>
              <div className="mt-3 flex justify-end gap-1">
                <VisibilityToggle id={v.id} active={v.status === 'active'} />
                <TriviaToggle id={v.id} enabled={v.trivia_enabled} />
                <VenueDialog
                  venue={v}
                  categories={cats}
                  territories={territories}
                  hosts={hosts}
                  defaultTerritoryId={t ?? ''}
                  pricingConfig={pricingConfig}
                />
                <DeleteButton id={v.id} action={deleteVenue} />
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table */}
        <div className="hidden rounded-lg border border-border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Venue</TableHead>
                <TableHead>Category</TableHead>
                {!t && <TableHead>Territory</TableHead>}
                <TableHead className="text-right">Foot traffic</TableHead>
                <TableHead className="text-right">Price / mo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No venues yet. Add your first location.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((v) => (
                <TableRow key={v.id} className={cn(v.status !== 'active' && 'opacity-50')}>
                  <TableCell>
                    <Link href={`/admin/venues/${v.id}`} className="font-medium hover:underline">
                      {v.name}
                    </Link>
                    {v.venue_type && (
                      <div className="text-xs text-muted-foreground">{v.venue_type}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {v.category?.name ?? '—'}
                  </TableCell>
                  {!t && (
                    <TableCell className="text-muted-foreground">
                      {v.territory?.name ?? '—'}
                    </TableCell>
                  )}
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(v.foot_traffic_estimate)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className="font-medium">{formatCents(tierPriceCents(venueTier(v), pricingConfig))}</span>
                    <span className="block text-xs text-muted-foreground">
                      {TIER_LABEL[venueTier(v)]}
                    </span>
                  </TableCell>
                  <TableCell>
                    {v.status !== 'active' ? (
                      <Badge variant="secondary">Hidden</Badge>
                    ) : isVenueListable(v) ? (
                      <Badge>On map</Badge>
                    ) : (
                      <Badge variant="warning">
                        Needs data
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <VisibilityToggle id={v.id} active={v.status === 'active'} />
                      <TriviaToggle id={v.id} enabled={v.trivia_enabled} />
                      <VenueDialog
                        venue={v}
                        categories={cats}
                        territories={territories}
                        hosts={hosts}
                        defaultTerritoryId={t ?? ''}
                        pricingConfig={pricingConfig}
                      />
                      <DeleteButton id={v.id} action={deleteVenue} />
                    </div>
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

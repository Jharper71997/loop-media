import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
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
import { formatNumber } from '@/lib/format'
import type { Category, Territory, Venue } from '@/lib/db.types'
import { VenueDialog } from './VenueDialog'
import { deleteVenue } from './actions'

type VenueRow = Venue & {
  category: { name: string } | null
  territory: { name: string } | null
}

export default async function VenuesPage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  let vq = supabase
    .from('venues')
    .select('*, category:categories(name), territory:territories(name)')
    .order('name')
  if (t) vq = vq.eq('territory_id', t)

  const [{ data: venues }, { data: categories }] = await Promise.all([
    vq,
    supabase.from('categories').select('*').order('name'),
  ])

  const rows = (venues ?? []) as VenueRow[]
  const cats = (categories ?? []) as Category[]
  const territories = territory.territories as Territory[]

  return (
    <>
      <PageHeader
        title="Venues"
        description={`${rows.length} location${rows.length === 1 ? '' : 's'}`}
        action={
          <VenueDialog
            categories={cats}
            territories={territories}
            defaultTerritoryId={t ?? ''}
          />
        }
      />

      <div className="p-6">
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Venue</TableHead>
                <TableHead>Category</TableHead>
                {!t && <TableHead>Territory</TableHead>}
                <TableHead className="text-right">Foot traffic</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No venues yet. Add your first location.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    <div className="font-medium">{v.name}</div>
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
                  <TableCell>
                    <Badge variant={v.status === 'active' ? 'default' : 'secondary'}>
                      {v.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <VenueDialog
                        venue={v}
                        categories={cats}
                        territories={territories}
                        defaultTerritoryId={t ?? ''}
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

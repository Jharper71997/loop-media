import Link from 'next/link'
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
import { timeAgo } from '@/lib/format'
import type { Tv } from '@/lib/db.types'
import { TvDialog } from './TvDialog'
import { RegenerateButton } from './RegenerateButton'
import { deleteTv } from './actions'

type TvRow = Tv & { venue: { name: string } | null }

const STATUS_VARIANT = {
  online: 'default',
  offline: 'destructive',
  unpaired: 'secondary',
} as const

export default async function TvsPage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  let venueQ = supabase.from('venues').select('id, name').order('name')
  if (t) venueQ = venueQ.eq('territory_id', t)
  const { data: venueList } = await venueQ
  const venues = venueList ?? []
  const venueIds = venues.map((v) => v.id)

  let rows: TvRow[] = []
  if (venueIds.length) {
    const { data } = await supabase
      .from('tvs')
      .select('*, venue:venues(name)')
      .in('venue_id', venueIds)
      .order('created_at', { ascending: false })
    rows = (data ?? []) as TvRow[]
  }

  return (
    <>
      <PageHeader
        title="TVs"
        description={`${rows.length} screen${rows.length === 1 ? '' : 's'}`}
        action={<TvDialog venues={venues} />}
      />

      <div className="p-5 md:p-6">
        {/* Mobile cards */}
        <div className="space-y-2.5 md:hidden">
          {rows.length === 0 && (
            <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              No TVs yet. Create one and share its pairing code.
            </p>
          )}
          {rows.map((tv) => (
            <div key={tv.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/admin/tvs/${tv.id}`} className="font-medium hover:underline">
                  {tv.venue?.name ?? '—'}
                </Link>
                <Badge variant={STATUS_VARIANT[tv.status]}>{tv.status}</Badge>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <code className="rounded bg-muted px-2 py-1 font-mono">{tv.pairing_code ?? '—'}</code>
                <span>
                  · {Math.round(tv.loop_length_seconds / 60)}m / {tv.slot_seconds}s
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Last seen {timeAgo(tv.last_heartbeat_at)}
              </div>
              <div className="mt-3 flex justify-end gap-1">
                <RegenerateButton id={tv.id} />
                <DeleteButton id={tv.id} action={deleteTv} />
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
                <TableHead>Pairing code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead className="text-right">Loop</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No TVs yet. Create one and share its pairing code with the venue.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((tv) => (
                <TableRow key={tv.id}>
                  <TableCell className="font-medium">
                    <Link href={`/admin/tvs/${tv.id}`} className="hover:underline">
                      {tv.venue?.name ?? '—'}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-2 py-1 font-mono text-sm">
                      {tv.pairing_code ?? '—'}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[tv.status]}>{tv.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {timeAgo(tv.last_heartbeat_at)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {Math.round(tv.loop_length_seconds / 60)}m / {tv.slot_seconds}s
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <RegenerateButton id={tv.id} />
                      <DeleteButton id={tv.id} action={deleteTv} />
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

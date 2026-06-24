import Link from 'next/link'
import { headers } from 'next/headers'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { kioskUrl } from '@/lib/tv'
import { PageHeader } from '@/components/admin/PageHeader'
import { DeleteButton } from '@/components/admin/DeleteButton'
import { LiveStatus } from '@/components/app/LiveStatus'
import { CopyField } from '@/components/app/CopyField'
import { AutoRefresh } from '@/components/app/AutoRefresh'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { timeAgo, isTvLive } from '@/lib/format'
import type { Tv } from '@/lib/db.types'
import { TvDialog } from './TvDialog'
import { RegenerateButton } from './RegenerateButton'
import { deleteTv } from './actions'

type TvRow = Tv & { venue: { name: string } | null }

export default async function TvsPage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  // Build the kiosk-URL origin from the live request so the link a provisioner
  // copies is always for the domain they're on (NEXT_PUBLIC_APP_URL is frozen at
  // build time and easy to leave stale across renames).
  const h = await headers()
  const reqHost = h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const origin = reqHost ? `${proto}://${reqHost}` : (process.env.NEXT_PUBLIC_APP_URL ?? '')

  let venueQ = supabase.from('venues').select('id, name').order('name')
  if (t) venueQ = venueQ.eq('territory_id', t)
  const { data: venueList } = await venueQ
  const venues = venueList ?? []
  const venueIds = venues.map((v) => v.id)

  let rows: TvRow[] = []
  const adsByTv = new Map<string, number>()
  const titlesByTv = new Map<string, string[]>()
  if (venueIds.length) {
    const { data } = await supabase
      .from('tvs')
      .select('*, venue:venues(name)')
      .in('venue_id', venueIds)
      .order('created_at', { ascending: false })
    rows = (data ?? []) as TvRow[]

    const tvIds = rows.map((r) => r.id)
    if (tvIds.length) {
      // Active placements + the ad title, in slot order, so each screen shows
      // exactly which ads are running on it — not just a count.
      const { data: pl } = await supabase
        .from('ad_placements')
        .select('tv_id, ad:ads(title)')
        .in('tv_id', tvIds)
        .eq('status', 'active')
        .order('slot_position')
      for (const p of (pl ?? []) as { tv_id: string; ad: { title: string } | { title: string }[] | null }[]) {
        adsByTv.set(p.tv_id, (adsByTv.get(p.tv_id) ?? 0) + 1)
        const ad = Array.isArray(p.ad) ? p.ad[0] : p.ad
        if (ad?.title) {
          const arr = titlesByTv.get(p.tv_id) ?? []
          arr.push(ad.title)
          titlesByTv.set(p.tv_id, arr)
        }
      }
    }
  }

  const liveCount = rows.filter((r) => !!r.device_id && isTvLive(r.last_heartbeat_at)).length

  return (
    <>
      <AutoRefresh seconds={20} />
      <PageHeader
        title="TVs"
        description={`${liveCount} of ${rows.length} screen${rows.length === 1 ? '' : 's'} live now`}
        action={<TvDialog venues={venues} />}
      />

      <div className="p-5 md:p-6">
        {/* Mobile cards */}
        <div className="space-y-2.5 md:hidden">
          {rows.length === 0 && (
            <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              No TVs yet. Create one to get a pairing code for the technician.
            </p>
          )}
          {rows.map((tv) => (
            <div key={tv.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/admin/tvs/${tv.id}`} className="font-medium hover:underline">
                  {tv.venue?.name ?? '—'}
                </Link>
                <LiveStatus
                  lastHeartbeat={tv.last_heartbeat_at}
                  paired={!!tv.device_id}
                  adsRunning={adsByTv.get(tv.id) ?? 0}
                />
              </div>
              <div className="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
                {tv.device_id ? (
                  <CopyField
                    value={kioskUrl(origin, tv.device_id)}
                    display={`/tv?device=…${tv.device_id.slice(-6)}`}
                    label="Copy link"
                  />
                ) : (
                  <code className="rounded bg-muted px-2 py-1 font-mono">{tv.pairing_code ?? '—'}</code>
                )}
                <span>
                  {Math.round(tv.loop_length_seconds / 60)}m / {tv.slot_seconds}s
                </span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                <span className="text-foreground/70">Playing: </span>
                {(titlesByTv.get(tv.id)?.length ?? 0) > 0
                  ? (titlesByTv.get(tv.id) ?? []).join(', ')
                  : 'nothing yet'}
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
                <TableHead>Pairing code / link</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Playing</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead className="text-right">Loop</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No TVs yet. Create one to get a pairing code for the technician.
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
                    {tv.device_id ? (
                      <CopyField
                        value={kioskUrl(origin, tv.device_id)}
                        display={`/tv?device=…${tv.device_id.slice(-6)}`}
                        label="Copy link"
                      />
                    ) : (
                      <code className="rounded bg-muted px-2 py-1 font-mono text-sm">
                        {tv.pairing_code ?? '—'}
                      </code>
                    )}
                  </TableCell>
                  <TableCell>
                    <LiveStatus
                      lastHeartbeat={tv.last_heartbeat_at}
                      paired={!!tv.device_id}
                      adsRunning={adsByTv.get(tv.id) ?? 0}
                    />
                  </TableCell>
                  <TableCell className="max-w-[18rem] text-sm text-muted-foreground">
                    {(titlesByTv.get(tv.id)?.length ?? 0) > 0 ? (
                      <span className="line-clamp-2">{(titlesByTv.get(tv.id) ?? []).join(', ')}</span>
                    ) : (
                      <span className="text-muted-foreground/60">nothing yet</span>
                    )}
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

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { LiveStatus } from '@/components/app/LiveStatus'
import { AutoRefresh } from '@/components/app/AutoRefresh'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { isTvLive, timeAgo } from '@/lib/format'
import { summarizeUptime, venueBusinessHours } from '@/lib/uptime'

export const dynamic = 'force-dynamic'

type VenueRow = {
  id: string
  name: string
  business_open: string | null
  business_close: string | null
  business_days: number[] | null
  tvs: { id: string; device_id: string | null; last_heartbeat_at: string | null }[]
}

export default async function UptimePage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  let venueQ = supabase
    .from('venues')
    .select(
      'id, name, business_open, business_close, business_days, tvs(id, device_id, last_heartbeat_at)'
    )
    .order('name')
  if (t) venueQ = venueQ.eq('territory_id', t)
  const { data: venueData } = await venueQ
  const venues = (venueData ?? []) as unknown as VenueRow[]

  const allTvIds = venues.flatMap((v) => v.tvs.map((tv) => tv.id))

  // Pull the last 30 days of per-screen uptime seconds in one query.
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 30)
  const sinceDay = since.toISOString().slice(0, 10)
  const uptimeByTv = new Map<string, { day: string; seconds: number }[]>()
  if (allTvIds.length) {
    const { data: up } = await supabase
      .from('tv_uptime_days')
      .select('tv_id, day, seconds')
      .in('tv_id', allTvIds)
      .gte('day', sinceDay)
    for (const r of (up ?? []) as { tv_id: string; day: string; seconds: number }[]) {
      const list = uptimeByTv.get(r.tv_id) ?? []
      list.push({ day: r.day, seconds: r.seconds })
      uptimeByTv.set(r.tv_id, list)
    }
  }

  // One row per paired screen, worst uptime first; unpaired screens excluded.
  type Row = {
    tvId: string
    venueName: string
    pct: number
    breach: boolean
    hasData: boolean
    downNow: boolean
    lastHeartbeat: string | null
    paired: boolean
  }
  const rows: Row[] = []
  for (const v of venues) {
    const bh = venueBusinessHours(v)
    for (const tv of v.tvs) {
      if (!tv.device_id) continue // not paired yet, nothing to measure
      const summary = summarizeUptime(uptimeByTv.get(tv.id) ?? [], bh)
      rows.push({
        tvId: tv.id,
        venueName: v.name,
        pct: summary.pct,
        breach: summary.breach,
        hasData: summary.hasData,
        downNow: !isTvLive(tv.last_heartbeat_at),
        lastHeartbeat: tv.last_heartbeat_at,
        paired: true,
      })
    }
  }
  rows.sort((a, b) => a.pct - b.pct)

  const breaches = rows.filter((r) => r.breach).length
  const downNow = rows.filter((r) => r.downNow).length

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader
        title="Uptime"
        description={`${rows.length} paired screen${rows.length === 1 ? '' : 's'} · ${breaches} below SLA · ${downNow} down now`}
      />

      <div className="space-y-4 p-5 md:p-6">
        {breaches > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-600/40 bg-amber-600/10 px-4 py-3 text-sm text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              {breaches} screen{breaches === 1 ? '' : 's'} ran below the 80% business-hours SLA over
              the last 30 days. Call the host, and rotate affected advertisers if a location stays
              dark.
            </span>
          </div>
        )}

        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Venue</TableHead>
                <TableHead>Uptime · 30d</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Now</TableHead>
                <TableHead className="text-right">Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No paired screens yet.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.tvId}>
                  <TableCell className="font-medium">
                    <Link href={`/admin/tvs/${r.tvId}`} className="hover:underline">
                      {r.venueName}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {r.hasData ? (
                      <span className={r.breach ? 'font-semibold text-amber-400' : ''}>
                        {Math.round(r.pct * 100)}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">No data</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.breach ? (
                      <Badge variant="destructive">Below SLA</Badge>
                    ) : r.hasData ? (
                      <Badge variant="secondary">Meeting SLA</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <LiveStatus lastHeartbeat={r.lastHeartbeat} paired={r.paired} />
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {timeAgo(r.lastHeartbeat)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground">
          Uptime is measured on-time during each venue&apos;s set business hours over the last 30
          days. The guarantee is 80% of business hours, not 24/7.
        </p>
      </div>
    </>
  )
}

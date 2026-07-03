import Link from 'next/link'
import { Tv, Inbox, Rocket, QrCode, PlayCircle, Store, UserPlus, ScanLine, Activity } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { formatNumber, timeAgo, isTvLive } from '@/lib/format'
import { AutoRefresh } from '@/components/app/AutoRefresh'

type FeedItem = { at: string; icon: typeof ScanLine; text: string }

export default async function AdminOverview() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  // Territory scope: venues have a territory; TVs/placements are scoped via them,
  // ads via territory_id.
  let venueIds: string[] | null = null
  if (t) {
    const { data } = await supabase.from('venues').select('id').eq('territory_id', t)
    venueIds = (data ?? []).map((v) => v.id)
  }
  const scopedVenueIds = venueIds && venueIds.length === 0 ? ['00000000-0000-0000-0000-000000000000'] : venueIds

  // Ads in scope (for QR scans + pending count).
  let scopedAdIds: string[] | null = null
  if (t) {
    const { data } = await supabase.from('ads').select('id').eq('territory_id', t)
    scopedAdIds = (data ?? []).map((a) => a.id)
  }

  // Screens (with heartbeat → true "live now").
  let tvQ = supabase.from('tvs').select('id, status, last_heartbeat_at')
  if (scopedVenueIds) tvQ = tvQ.in('venue_id', scopedVenueIds)
  const { data: tvRows } = await tvQ
  const tvs = (tvRows ?? []) as { id: string; status: string; last_heartbeat_at: string | null }[]
  const totalTvs = tvs.length
  const liveTvs = tvs.filter((r) => isTvLive(r.last_heartbeat_at)).length
  const tvIds = tvs.map((r) => r.id)

  // Ads playing right now (active placements on in-scope screens) + a sample.
  let playing: { ad: { title: string } | null; tv: { venue: { name: string } | null } | null }[] = []
  if (tvIds.length) {
    const { data } = await supabase
      .from('ad_placements')
      .select('ad:ads(title), tv:tvs(venue:venues(name))')
      .eq('status', 'active')
      .in('tv_id', tvIds)
    playing = (data ?? []) as unknown as typeof playing
  }
  const adsPlaying = playing.length

  // Counts.
  const pendingQ = (() => {
    let q = supabase.from('ads').select('id', { count: 'exact', head: true }).eq('status', 'pending')
    if (t) q = q.eq('territory_id', t)
    return q
  })()
  const campQ = (() => {
    let q = supabase.from('campaigns').select('id', { count: 'exact', head: true }).eq('status', 'active')
    if (t) q = q.eq('territory_id', t)
    return q
  })()

  const sinceDate = new Date()
  sinceDate.setUTCHours(sinceDate.getUTCHours() - 24)
  const sinceIso = sinceDate.toISOString()
  const scansTodayQ = (() => {
    let q = supabase
      .from('qr_scans')
      .select('id', { count: 'exact', head: true })
      .gte('scanned_at', sinceIso)
    if (scopedAdIds) q = q.in('ad_id', scopedAdIds.length ? scopedAdIds : ['00000000-0000-0000-0000-000000000000'])
    return q
  })()

  const [{ count: pending }, { count: activeCampaigns }, { count: scansToday }] = await Promise.all([
    pendingQ,
    campQ,
    scansTodayQ,
  ])

  // ---- Recent activity feed (most recent across a few event types) ----
  const feed: FeedItem[] = []

  // Recent QR scans.
  {
    let q = supabase
      .from('qr_scans')
      .select('scanned_at, ad:ads(title), tv:tvs(venue:venues(name))')
      .order('scanned_at', { ascending: false })
      .limit(6)
    if (scopedAdIds) q = q.in('ad_id', scopedAdIds.length ? scopedAdIds : ['00000000-0000-0000-0000-000000000000'])
    const { data } = await q
    for (const s of (data ?? []) as unknown as {
      scanned_at: string
      ad: { title: string } | null
      tv: { venue: { name: string } | null } | null
    }[]) {
      feed.push({
        at: s.scanned_at,
        icon: ScanLine,
        text: `QR scan${s.ad?.title ? ` · ${s.ad.title}` : ''}${s.tv?.venue?.name ? ` at ${s.tv.venue.name}` : ''}`,
      })
    }
  }

  // Recently added venues.
  {
    let q = supabase
      .from('venues')
      .select('name, status, created_at')
      .order('created_at', { ascending: false })
      .limit(5)
    if (t) q = q.eq('territory_id', t)
    const { data } = await q
    for (const v of (data ?? []) as { name: string; status: string; created_at: string }[]) {
      feed.push({
        at: v.created_at,
        icon: Store,
        text: `New venue · ${v.name}${v.status !== 'active' ? ' (pending)' : ''}`,
      })
    }
  }

  // Recent signups (advertisers + hosts).
  {
    let q = supabase
      .from('profiles')
      .select('email, full_name, role, created_at')
      .in('role', ['advertiser', 'host'])
      .order('created_at', { ascending: false })
      .limit(5)
    if (t) q = q.eq('territory_id', t)
    const { data } = await q
    for (const p of (data ?? []) as {
      email: string
      full_name: string | null
      role: string
      created_at: string
    }[]) {
      feed.push({
        at: p.created_at,
        icon: UserPlus,
        text: `New ${p.role} · ${p.full_name ?? p.email}`,
      })
    }
  }

  feed.sort((a, b) => (a.at < b.at ? 1 : -1))
  const recent = feed.slice(0, 8)

  const liveStats = [
    { label: 'Screens live now', value: `${liveTvs}/${totalTvs}`, icon: Tv, href: '/admin/venues' },
    { label: 'Ads playing now', value: formatNumber(adsPlaying), icon: PlayCircle, href: '/admin/map' },
    { label: 'Pending approvals', value: formatNumber(pending ?? 0), icon: Inbox, href: '/admin/queue', highlight: (pending ?? 0) > 0 },
    { label: 'Active campaigns', value: formatNumber(activeCampaigns ?? 0), icon: Rocket, href: '/admin/advertisers' },
    { label: 'QR scans · 24h', value: formatNumber(scansToday ?? 0), icon: QrCode, href: '/admin/advertisers' },
  ]

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader
        title="Live overview"
        description={t ? territory.territories.find((x) => x.id === t)?.name : 'All territories'}
        action={
          (pending ?? 0) > 0 ? (
            <Link href="/admin/queue" className={buttonVariants()}>
              Review {pending} pending
            </Link>
          ) : undefined
        }
      />

      <div className="space-y-6 p-5 md:p-6">
        {/* Live tiles */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {liveStats.map((s) => (
            <Link key={s.label} href={s.href} className="group">
              <Card className="transition-colors group-hover:border-primary/50">
                <CardContent className="flex items-center justify-between p-5">
                  <div>
                    <p className="text-sm text-muted-foreground">{s.label}</p>
                    <p className={'mt-1 font-heading text-3xl font-bold tabular-nums ' + (s.highlight ? 'text-primary' : '')}>
                      {s.value}
                    </p>
                  </div>
                  <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-110">
                    <s.icon className="size-5" />
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Now playing */}
          <Card>
            <CardContent className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <PlayCircle className="size-4 text-primary" />
                <h2 className="text-sm font-medium">On screens right now</h2>
              </div>
              {adsPlaying === 0 ? (
                <p className="text-sm text-muted-foreground">No ads are placed on any screens yet.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {playing.slice(0, 8).map((p, i) => (
                    <li key={i} className="flex items-center justify-between gap-3">
                      <span className="truncate">{p.ad?.title ?? 'Ad'}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {p.tv?.venue?.name ?? '—'}
                      </span>
                    </li>
                  ))}
                  {adsPlaying > 8 && (
                    <li className="pt-1 text-xs text-muted-foreground">+{adsPlaying - 8} more…</li>
                  )}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Recent activity */}
          <Card>
            <CardContent className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <Activity className="size-4 text-primary" />
                <h2 className="text-sm font-medium">Recent activity</h2>
              </div>
              {recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {recent.map((f, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      <f.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{f.text}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(f.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}

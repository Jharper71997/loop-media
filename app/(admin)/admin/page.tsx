import Link from 'next/link'
import { Store, Tv, Inbox, Megaphone, Users, Rocket, QrCode } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { formatNumber } from '@/lib/format'

export default async function AdminOverview() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  // Venue ids in scope (used to scope TVs, which have no territory_id of their own).
  let venueIds: string[] | null = null
  if (t) {
    const { data } = await supabase.from('venues').select('id').eq('territory_id', t)
    venueIds = (data ?? []).map((v) => v.id)
  }
  const scopedVenueIds =
    venueIds && venueIds.length === 0 ? ['00000000-0000-0000-0000-000000000000'] : venueIds

  const countAds = async (status: string) => {
    let q = supabase.from('ads').select('id', { count: 'exact', head: true }).eq('status', status)
    if (t) q = q.eq('territory_id', t)
    return (await q).count ?? 0
  }

  const venueQ = supabase.from('venues').select('id', { count: 'exact', head: true })
  if (t) venueQ.eq('territory_id', t)

  const advQ = supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'advertiser')
  if (t) advQ.eq('territory_id', t)

  const campQ = supabase
    .from('campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
  if (t) campQ.eq('territory_id', t)

  let tvQ = supabase.from('tvs').select('status')
  if (scopedVenueIds) tvQ = tvQ.in('venue_id', scopedVenueIds)

  const [{ count: venueCount }, { count: advCount }, { count: campCount }, { data: tvRows }, pending, active] =
    await Promise.all([venueQ, advQ, campQ, tvQ, countAds('pending'), countAds('active')])

  const totalTvs = tvRows?.length ?? 0
  const onlineTvs = tvRows?.filter((r) => r.status === 'online').length ?? 0

  // QR scans rollup (scoped to the territory's ads when one is selected).
  let scans = 0
  if (t) {
    const { data: adRows } = await supabase.from('ads').select('id').eq('territory_id', t)
    const adIds = (adRows ?? []).map((a) => a.id)
    if (adIds.length) {
      const { count } = await supabase
        .from('qr_scans')
        .select('id', { count: 'exact', head: true })
        .in('ad_id', adIds)
      scans = count ?? 0
    }
  } else {
    const { count } = await supabase.from('qr_scans').select('id', { count: 'exact', head: true })
    scans = count ?? 0
  }

  const stats = [
    { label: 'Venues', value: formatNumber(venueCount ?? 0), icon: Store, href: '/admin/venues' },
    { label: 'Screens online', value: `${onlineTvs}/${totalTvs}`, icon: Tv, href: '/admin/tvs' },
    { label: 'Pending approvals', value: formatNumber(pending), icon: Inbox, href: '/admin/queue', highlight: pending > 0 },
    { label: 'Active ads', value: formatNumber(active), icon: Megaphone, href: '/admin/queue' },
    { label: 'Advertisers', value: formatNumber(advCount ?? 0), icon: Users, href: '/admin/advertisers' },
    { label: 'Active campaigns', value: formatNumber(campCount ?? 0), icon: Rocket, href: '/admin/advertisers' },
    { label: 'QR scans', value: formatNumber(scans), icon: QrCode, href: '/admin/advertisers' },
  ]

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          territory.activeId
            ? territory.territories.find((x) => x.id === territory.activeId)?.name
            : 'All territories'
        }
        action={
          pending > 0 ? (
            <Link href="/admin/queue" className={buttonVariants()}>
              Review {pending} pending
            </Link>
          ) : undefined
        }
      />
      <div className="grid gap-4 p-5 sm:grid-cols-2 md:p-6 lg:grid-cols-3">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="group">
            <Card className="transition-colors group-hover:border-primary/50">
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="text-sm text-muted-foreground">{s.label}</p>
                  <p
                    className={
                      'mt-1 font-heading text-3xl font-bold tabular-nums ' +
                      (s.highlight ? 'text-primary' : '')
                    }
                  >
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
    </>
  )
}

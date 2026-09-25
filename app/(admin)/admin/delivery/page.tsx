import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, SELL_TABS } from '@/components/admin/SectionTabs'
import { HudBody, StatStrip, Stat } from '@/components/admin/hud'
import { loadDelivery, DELIVERY_WINDOW_DAYS } from '@/lib/delivery'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ByAdvertiserTable, ByLocationTable } from './DeliveryTables'

// Where ads run: every live ad on every screen, readable from either side.
// See lib/delivery.ts for why this exists and how the numbers are counted.

export default async function DeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ by?: string }>
}) {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const { by } = await searchParams
  const byLocation = by === 'location'
  const { byAdvertiser, byLocation: locations, totals } = await loadDelivery(territory.activeId)
  const noAccount = byAdvertiser.filter((a) => a.noAccount).length

  return (
    <>
      <PageHeader
        title="Where ads run"
        description={`${totals.ads} ads on ${totals.screens} screens at ${totals.locations} locations · last ${DELIVERY_WINDOW_DAYS} days`}
      />
      <SectionTabs tabs={SELL_TABS} />
      <HudBody>
        <StatStrip cols={6}>
          <Stat label="Advertisers on air" value={formatNumber(totals.advertisers)} />
          <Stat label="Screens carrying ads" value={formatNumber(totals.screens)} />
          <Stat
            label="Dark right now"
            value={formatNumber(totals.darkScreens)}
            tone={totals.darkScreens ? 'bad' : 'good'}
            href="/admin/uptime"
          />
          <Stat label={`Shown ${DELIVERY_WINDOW_DAYS}d`} value={formatNumber(totals.plays)} title="Measured plays, all hours" />
          <Stat label={`Scans ${DELIVERY_WINDOW_DAYS}d`} value={formatNumber(totals.scans)} title="Measured QR scans, bots excluded" />
          <Stat
            label="No account"
            value={formatNumber(noAccount)}
            tone={noAccount ? 'warn' : undefined}
            sub="Placed from your login"
            title="Ads on your admin login with no campaign. Billing and the Advertisers list cannot see them."
          />
        </StatStrip>

        <div className="flex gap-1 rounded-lg border border-border bg-card p-1 text-[13px] sm:w-fit">
          {[
            { href: '/admin/delivery', label: 'By advertiser', active: !byLocation },
            { href: '/admin/delivery?by=location', label: 'By location', active: byLocation },
          ].map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-center transition-colors sm:flex-none',
                t.active ? 'bg-primary/15 font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </Link>
          ))}
        </div>

        {byLocation ? <ByLocationTable rows={locations} /> : <ByAdvertiserTable rows={byAdvertiser} />}
      </HudBody>
    </>
  )
}

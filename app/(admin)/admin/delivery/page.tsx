import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, SELL_TABS } from '@/components/admin/SectionTabs'
import { HudBody, StatStrip, Stat } from '@/components/admin/hud'
import { loadDelivery } from '@/lib/delivery'
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
  const { byAdvertiser, byLocation: locations, screens, totals } = await loadDelivery(territory.activeId)

  return (
    <>
      <PageHeader
        title="Where ads run"
        description="Which screens each ad is on. Tap ✕ to take an ad off a screen."
      />
      <SectionTabs tabs={SELL_TABS} />
      <HudBody>
        <StatStrip cols={3} className="grid-cols-3">
          <Stat label="Advertisers on air" value={formatNumber(totals.advertisers)} />
          <Stat label="Screens playing ads" value={formatNumber(totals.screens)} />
          <Stat
            label="Screens off right now"
            value={formatNumber(totals.darkScreens)}
            tone={totals.darkScreens ? 'bad' : 'good'}
            href="/admin/uptime"
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

        {byLocation ? <ByLocationTable rows={locations} /> : <ByAdvertiserTable rows={byAdvertiser} screens={screens} />}
      </HudBody>
    </>
  )
}

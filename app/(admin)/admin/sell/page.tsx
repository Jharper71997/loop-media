import Link from 'next/link'
import { Plus, Mail, Phone, User } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, ADVERTISER_TABS } from '@/components/admin/SectionTabs'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { ExportCsvButton } from '@/components/admin/ExportCsvButton'
import { HudBody, StatStrip, Stat, Panel, Num } from '@/components/admin/hud'
import { formatCents, formatNumber } from '@/lib/format'
import { loadInventory } from '@/lib/inventory'
import { loadBillingRows } from '@/lib/adminInbox'
import { getSettings } from '@/lib/settings.server'
import { getPricingConfig } from '@/lib/pricing.server'

// The page that answers "who do I call today".
//
// Sorted by open spots, because a location with five unsold spots is worth five
// calls and a full one is worth none. Everything you need to make the call is on
// the row: the rate, the contact, what already runs there, and which line of
// business you can never sell into (the venue's own — host protection).

export default async function SellPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>
}) {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const { show } = await searchParams

  const [inventory, billingRows, settings, pricing] = await Promise.all([
    loadInventory(t),
    loadBillingRows(t),
    getSettings(),
    getPricingConfig(),
  ])
  const { totals } = inventory

  // "N more spots at $75" used to hardcode 7500. It now reads the live rate, so
  // repricing a location on /admin/pricing moves the number of calls this page
  // says the goal is worth.
  const rateCents = pricing.tierPriceCents.standard

  const mrrCents = billingRows
    .filter((r) => r.billing.method !== 'comp' && r.billing.method !== 'unbilled')
    .reduce((a, r) => a + r.monthlyCents, 0)
  const goalCents = settings.mrr_goal_cents
  const gapCents = Math.max(0, goalCents - mrrCents)

  // Default view hides locations with nothing left to sell — they aren't a call.
  const showAll = show === 'all'
  const rows = inventory.rows
    .filter((r) => r.active)
    .filter((r) => showAll || r.open > 0)
    .sort((a, b) => b.open - a.open || b.priceCents - a.priceCents)

  const hidden = inventory.rows.filter((r) => r.active).length - rows.length

  const csvRows = rows.map((r) => ({
    location: r.name,
    city: r.city ?? '',
    open_spots: r.open,
    monthly_rate_usd: (r.priceCents / 100).toFixed(2),
    open_value_usd: (r.openValueCents / 100).toFixed(2),
    cannot_sell_category: r.ownCategory ?? '',
    already_running: r.runningTitles.join('; '),
    contact: r.contact.name ?? r.hostName ?? '',
    email: r.contact.email ?? '',
    phone: r.contact.phone ?? '',
  }))

  return (
    <>
      <PageHeader
        title="Sell"
        description={`${totals.open} open spot${totals.open === 1 ? '' : 's'} across ${totals.venues} location${totals.venues === 1 ? '' : 's'}`}
        action={
          <div className="flex items-center gap-2">
            <ExportCsvButton filename="loop-open-inventory.csv" rows={csvRows} />
            <Link href="/admin/deals/new" className={buttonVariants({ size: 'sm' })}>
              <Plus className="size-4" /> New deal
            </Link>
          </div>
        }
      />
      <SectionTabs tabs={ADVERTISER_TABS} />

      <HudBody>
        {/* ---- The gap, stated plainly ---- */}
        <StatStrip cols={4}>
          <Stat
            label="Open spots"
            value={formatNumber(totals.open)}
            sub={`${100 - totals.pctSold}% of the network`}
          />
          <Stat
            label="Open inventory"
            value={`${formatCents(totals.openValueCents)}/mo`}
            sub="if every spot sold at today's rate"
          />
          <Stat
            label="Billed MRR"
            value={`${formatCents(mrrCents)}/mo`}
            sub={`${formatCents(totals.soldValueCents)}/mo placed`}
            href="/admin/money"
          />
          <Stat
            label={`Gap to ${formatCents(goalCents)}`}
            value={`${formatCents(gapCents)}/mo`}
            sub={
              gapCents === 0
                ? `Goal met — ${settings.mrr_goal_label}`
                : `${Math.ceil(gapCents / rateCents)} more spots at ${formatCents(rateCents)} · by ${settings.mrr_goal_label}`
            }
            tone={gapCents > 0 ? 'warn' : 'good'}
          />
        </StatStrip>

        <Panel
          title={showAll ? 'Every active location' : 'Locations with spots to sell'}
          bodyClassName="p-0"
          action={
            <Link
              href={showAll ? '/admin/sell' : '/admin/sell?show=all'}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              {showAll
                ? 'Hide sold-out'
                : hidden > 0
                  ? `Show ${hidden} sold-out`
                  : 'Show all'}
            </Link>
          }
        >
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {inventory.rows.length === 0
                ? 'No venues yet. Add a location before you can sell against it.'
                : 'Every active location is sold out. Time to add screens.'}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.venueId} className="px-3 py-2">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <Link
                      href={`/admin/venues/${r.venueId}`}
                      className="text-[13px] font-medium hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.open > 0 ? (
                      <Badge>{r.open} open</Badge>
                    ) : (
                      <Badge variant="secondary">Sold out</Badge>
                    )}
                    {r.liveScreens === 0 && r.screens.length > 0 && (
                      <Badge variant="warning">No screen live</Badge>
                    )}
                    {r.screens.length === 0 && <Badge variant="warning">No screen yet</Badge>}

                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      <Num className="text-sm font-semibold">
                        {formatCents(r.openValueCents)}
                      </Num>
                      <span className="text-[11px] text-muted-foreground">/mo open</span>
                      {r.open > 0 && (
                        <Link
                          href={`/admin/deals/new?venue=${r.venueId}`}
                          className={buttonVariants({ size: 'sm', variant: 'outline' })}
                        >
                          Sell this
                        </Link>
                      )}
                    </span>
                  </div>

                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
                    {r.city && <span>{r.city}</span>}
                    <span className="font-medium text-primary">
                      <Num>{formatCents(r.priceCents)}</Num>/mo · {r.tierLabel}
                    </span>
                    <span>
                      <Num>{formatNumber(r.footTraffic)}</Num>/mo traffic
                    </span>
                    <span>
                      <Num>
                        {r.sold}/{r.totalSlots}
                      </Num>{' '}
                      sold on {r.screens.length} screen{r.screens.length === 1 ? '' : 's'}
                    </span>
                    {/* Host protection: the one pitch that can never land here. */}
                    {r.ownCategory && (
                      <span>
                        no <span className="font-medium text-foreground">{r.ownCategory}</span>
                      </span>
                    )}
                    {r.runningTitles.length > 0 && (
                      <span className="min-w-0 truncate">Running: {r.runningTitles.join(', ')}</span>
                    )}

                    <span className="ml-auto flex shrink-0 flex-wrap items-center gap-2.5">
                      {(r.contact.name || r.hostName) && (
                        <span className="inline-flex items-center gap-1">
                          <User className="size-3" />
                          {r.contact.name ?? r.hostName}
                        </span>
                      )}
                      {r.contact.email && (
                        <a
                          href={`mailto:${r.contact.email}`}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          <Mail className="size-3" />
                          {r.contact.email}
                        </a>
                      )}
                      {r.contact.phone && (
                        <a
                          href={`tel:${r.contact.phone}`}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          <Phone className="size-3" />
                          {r.contact.phone}
                        </a>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </HudBody>
    </>
  )
}

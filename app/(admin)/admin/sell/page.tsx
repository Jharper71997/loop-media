import Link from 'next/link'
import { Plus, Mail, Phone, Users } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { PageHeader } from '@/components/admin/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { ExportCsvButton } from '@/components/admin/ExportCsvButton'
import { formatCents, formatNumber } from '@/lib/format'
import { loadInventory } from '@/lib/inventory'
import { loadBillingRows } from '@/lib/adminInbox'
import { MRR_GOAL_CENTS, MRR_GOAL_LABEL } from '@/lib/billing'
import { cn } from '@/lib/utils'

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

  const [inventory, billingRows] = await Promise.all([loadInventory(t), loadBillingRows(t)])
  const { totals } = inventory

  const mrrCents = billingRows
    .filter((r) => r.billing.method !== 'comp' && r.billing.method !== 'unbilled')
    .reduce((a, r) => a + r.monthlyCents, 0)
  const gapCents = Math.max(0, MRR_GOAL_CENTS - mrrCents)

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
            <Link href="/admin/deals/new" className={buttonVariants()}>
              <Plus className="size-4" /> New deal
            </Link>
          </div>
        }
      />

      <div className="space-y-6 p-5 md:p-6">
        {/* ---- The gap, stated plainly ---- */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Open spots" value={formatNumber(totals.open)} sub={`${100 - totals.pctSold}% of the network`} />
          <Stat
            label="Open inventory"
            value={`${formatCents(totals.openValueCents)}/mo`}
            sub="if every spot sold at today's rate"
          />
          <Stat label="Billed MRR" value={`${formatCents(mrrCents)}/mo`} sub={`${formatCents(totals.soldValueCents)}/mo placed`} />
          <Stat
            label={`Gap to ${formatCents(MRR_GOAL_CENTS)}`}
            value={`${formatCents(gapCents)}/mo`}
            sub={
              gapCents === 0
                ? `Goal met — ${MRR_GOAL_LABEL}`
                : `${Math.ceil(gapCents / 7500)} more spots at $75 · by ${MRR_GOAL_LABEL}`
            }
            tone={gapCents > 0 ? 'warn' : 'good'}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">
            {showAll ? 'Every active location' : 'Locations with spots to sell'}
          </h2>
          <Link
            href={showAll ? '/admin/sell' : '/admin/sell?show=all'}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showAll
              ? 'Hide sold-out locations'
              : hidden > 0
                ? `Show ${hidden} sold-out location${hidden === 1 ? '' : 's'}`
                : 'Show all'}
          </Link>
        </div>

        {rows.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            {inventory.rows.length === 0
              ? 'No venues yet. Add a location before you can sell against it.'
              : 'Every active location is sold out. Time to add screens.'}
          </p>
        ) : (
          <div className="space-y-2.5">
            {rows.map((r) => (
              <div key={r.venueId} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/venues/${r.venueId}`} className="font-medium hover:underline">
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
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {r.city && <span>{r.city}</span>}
                      <span className="font-medium text-primary">
                        {formatCents(r.priceCents)}/mo · {r.tierLabel}
                      </span>
                      <span>{formatNumber(r.footTraffic)}/mo traffic</span>
                      <span>
                        {r.sold}/{r.totalSlots} spots sold on {r.screens.length} screen
                        {r.screens.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-heading text-lg font-bold tabular-nums">
                      {formatCents(r.openValueCents)}
                    </p>
                    <p className="text-xs text-muted-foreground">/mo available here</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-3 text-xs">
                  {/* Host protection: this is the one pitch that can never land here. */}
                  {r.ownCategory && (
                    <span className="text-muted-foreground">
                      Can&apos;t sell{' '}
                      <span className="font-medium text-foreground">{r.ownCategory}</span> here
                    </span>
                  )}
                  {r.runningTitles.length > 0 && (
                    <span className="min-w-0 truncate text-muted-foreground">
                      Running: {r.runningTitles.join(', ')}
                    </span>
                  )}
                  <span className="ml-auto flex flex-wrap items-center gap-3">
                    {(r.contact.name || r.hostName) && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Users className="size-3" />
                        {r.contact.name ?? r.hostName}
                      </span>
                    )}
                    {r.contact.email && (
                      <a
                        href={`mailto:${r.contact.email}`}
                        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                      >
                        <Mail className="size-3" />
                        {r.contact.email}
                      </a>
                    )}
                    {r.contact.phone && (
                      <a
                        href={`tel:${r.contact.phone}`}
                        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                      >
                        <Phone className="size-3" />
                        {r.contact.phone}
                      </a>
                    )}
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
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub: string
  tone?: 'warn' | 'good'
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={cn(
            'mt-1 font-heading text-2xl font-bold tabular-nums',
            tone === 'warn' && 'text-warning',
            tone === 'good' && 'text-primary'
          )}
        >
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  )
}

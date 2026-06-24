import type { ReactNode } from 'react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { InlineNumber } from '@/components/admin/InlineNumber'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { Package } from '@/lib/db.types'
import { DEFAULT_PRICING_CONFIG, TIER_LABEL, type PriceTier } from '@/lib/pricing'
import { ActiveToggle } from '../packages/ActiveToggle'
import {
  setPackageScreenCap,
  setPackageGoal,
  setPackagePrice,
  setTerritoryPrice,
} from '../packages/actions'
import {
  setTierPrice,
  setMinMonthly,
  setHostDiscount,
  setLoyaltyDiscount,
  setMaxDiscount,
} from './actions'

const TIERS: PriceTier[] = ['local', 'standard', 'high', 'premium']
const TIER_BAND: Record<PriceTier, string> = {
  local: 'under 400 / day',
  standard: '400-800 / day',
  high: '800-1,500 / day',
  premium: '1,500+ / day',
}

type ConfigRow = {
  local_price_cents: number
  standard_price_cents: number
  high_price_cents: number
  premium_price_cents: number
  min_monthly_cents: number
  host_discount_pct: number
  loyalty_12mo_discount_pct: number
  max_discount_pct: number
}

export default async function PricingPage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  // --- Packages (+ per-territory overrides for the active market) ---
  const { data: pkgData } = await supabase
    .from('packages')
    .select('*')
    .order('base_price_cents', { ascending: true })
  const packages = (pkgData ?? []) as Package[]

  const overrideByPackage = new Map<string, number>()
  if (t && packages.length) {
    const { data: overrides } = await supabase
      .from('package_territory_prices')
      .select('package_id, price_cents')
      .eq('territory_id', t)
    for (const o of overrides ?? []) overrideByPackage.set(o.package_id, o.price_cents)
  }
  const activeName = territory.territories.find((x) => x.id === t)?.name

  // --- Tier pricing config ---
  const { data } = await supabase
    .from('pricing_config')
    .select('*')
    .eq('id', 'default')
    .maybeSingle()

  // Fall back to the seeded defaults if the row hasn't been created yet.
  const d = DEFAULT_PRICING_CONFIG
  const cfg: ConfigRow = (data as ConfigRow | null) ?? {
    local_price_cents: d.tierPriceCents.local,
    standard_price_cents: d.tierPriceCents.standard,
    high_price_cents: d.tierPriceCents.high,
    premium_price_cents: d.tierPriceCents.premium,
    min_monthly_cents: d.minMonthlyCents,
    host_discount_pct: d.hostDiscount,
    loyalty_12mo_discount_pct: d.loyalty12moDiscount,
    max_discount_pct: d.maxDiscount,
  }

  const tierCents: Record<PriceTier, number> = {
    local: cfg.local_price_cents,
    standard: cfg.standard_price_cents,
    high: cfg.high_price_cents,
    premium: cfg.premium_price_cents,
  }

  return (
    <>
      <PageHeader
        title="Packages & pricing"
        description={
          t
            ? `Packages, per-screen tier prices, and ${activeName} overrides. Edits go live immediately.`
            : 'Packages, per-screen tier prices, the account minimum, and discounts. Edits go live immediately.'
        }
      />

      <div className="max-w-3xl space-y-8 p-6">
        {/* Packages */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Packages</h2>
            <p className="text-xs text-muted-foreground">
              {t
                ? `Base prices, plus optional ${activeName} overrides.`
                : 'Global package templates. Select a single territory in the sidebar to set per-market overrides.'}
            </p>
          </div>
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Package</TableHead>
                  <TableHead>Screen cap</TableHead>
                  <TableHead>Goal (impr/mo)</TableHead>
                  <TableHead>Base price ($/mo)</TableHead>
                  {t && <TableHead>{activeName} price ($/mo)</TableHead>}
                  <TableHead className="text-right">Visibility</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packages.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={t ? 6 : 5} className="py-10 text-center text-muted-foreground">
                      No packages yet.
                    </TableCell>
                  </TableRow>
                )}
                {packages.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        <Badge variant="secondary" className="capitalize">
                          {p.tier}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <InlineNumber
                        initial={p.screen_cap}
                        allowEmpty
                        min={1}
                        placeholder="unlimited"
                        action={setPackageScreenCap.bind(null, p.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <InlineNumber
                        initial={p.target_impressions || null}
                        allowEmpty
                        min={0}
                        placeholder="0"
                        action={setPackageGoal.bind(null, p.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <InlineNumber
                        initial={p.base_price_cents / 100}
                        allowEmpty={false}
                        min={0}
                        action={setPackagePrice.bind(null, p.id)}
                      />
                    </TableCell>
                    {t && (
                      <TableCell>
                        <InlineNumber
                          initial={
                            overrideByPackage.has(p.id)
                              ? (overrideByPackage.get(p.id) as number) / 100
                              : null
                          }
                          allowEmpty
                          min={0}
                          placeholder="use base"
                          action={setTerritoryPrice.bind(null, p.id, t)}
                        />
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <ActiveToggle id={p.id} active={p.active} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        {/* Per-screen tier prices */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Screen price by tier ($/mo)</h2>
            <p className="text-xs text-muted-foreground">
              Auto-assigned from a venue&apos;s foot traffic. Floor is $25 — no screen can go below
              it.
            </p>
          </div>
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tier</TableHead>
                  <TableHead>Foot traffic</TableHead>
                  <TableHead className="text-right">Price ($/mo)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TIERS.map((tier) => (
                  <TableRow key={tier}>
                    <TableCell className="font-medium">{TIER_LABEL[tier]}</TableCell>
                    <TableCell className="text-muted-foreground">{TIER_BAND[tier]}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <InlineNumber
                          initial={tierCents[tier] / 100}
                          allowEmpty={false}
                          min={75}
                          action={setTierPrice.bind(null, tier)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        {/* Account minimum + discounts */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Account minimum &amp; discounts</h2>
          <div className="rounded-lg border border-border">
            <Table>
              <TableBody>
                <SettingRow
                  label="Account minimum ($/mo)"
                  hint="Smallest monthly bill to open an advertiser account."
                >
                  <InlineNumber
                    initial={cfg.min_monthly_cents / 100}
                    allowEmpty={false}
                    min={0}
                    action={setMinMonthly}
                  />
                </SettingRow>
                <SettingRow
                  label="Host discount (%)"
                  hint="Off the per-screen rate for hosts who also advertise."
                >
                  <InlineNumber
                    initial={Math.round(cfg.host_discount_pct * 100)}
                    allowEmpty={false}
                    min={0}
                    action={setHostDiscount}
                  />
                </SettingRow>
                <SettingRow
                  label="12-month loyalty discount (%)"
                  hint="Extra off for accounts active a full year."
                >
                  <InlineNumber
                    initial={Math.round(cfg.loyalty_12mo_discount_pct * 100)}
                    allowEmpty={false}
                    min={0}
                    action={setLoyaltyDiscount}
                  />
                </SettingRow>
                <SettingRow
                  label="Max combined discount (%)"
                  hint="Cap so host + volume + loyalty can't stack past this."
                >
                  <InlineNumber
                    initial={Math.round(cfg.max_discount_pct * 100)}
                    allowEmpty={false}
                    min={0}
                    action={setMaxDiscount}
                  />
                </SettingRow>
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Volume discounts (more screens, lower rate) are fixed in code for now.
          </p>
        </section>
      </div>
    </>
  )
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: ReactNode
}) {
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </TableCell>
      <TableCell>
        <div className="flex justify-end">{children}</div>
      </TableCell>
    </TableRow>
  )
}

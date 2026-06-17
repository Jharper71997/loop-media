import type { ReactNode } from 'react'
import { requireAdmin } from '@/lib/auth'
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
import { DEFAULT_PRICING_CONFIG, TIER_LABEL, type PriceTier } from '@/lib/pricing'
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
  await requireAdmin()
  const supabase = await createClient()
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
        title="Tier pricing"
        description="What each screen costs per month, plus the account minimum and discounts. Edits go live immediately."
      />

      <div className="max-w-3xl space-y-8 p-6">
        {/* Per-screen tier prices */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Screen price by tier ($/mo)</h2>
            <p className="text-xs text-muted-foreground">
              Auto-assigned from a venue&apos;s foot traffic. Floor is $75 — no screen can go below
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

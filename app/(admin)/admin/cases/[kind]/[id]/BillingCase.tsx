import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatCents, formatNumber, timeAgo, formatDateTime } from '@/lib/format'
import { loadBillingRows } from '@/lib/adminInbox'
import {
  CaseShell,
  CaseSection,
  Evidence,
  EvidenceGrid,
  CaseAction,
  CaseActions,
} from '@/components/admin/CaseShell'

// Money we are not collecting — either because we chose not to (a comp) or
// because nobody chased it (overdue, or never billed at all).
//
// The number that makes this decidable is not the invoice. It is what we have
// already DELIVERED for free: the plays, the screens and the months. A comp with
// 40,000 plays behind it is a conversation you can win; a comp nobody noticed is
// just a hole in the month.

const DAY_MS = 86_400_000
const WINDOW_DAYS = 30

export async function BillingCase({
  campaignId,
  kind,
}: {
  campaignId: string
  kind: 'free-rider' | 'money-overdue'
}) {
  const supabase = await createClient()
  const sinceISO = new Date(Date.now() - WINDOW_DAYS * DAY_MS).toISOString()

  const { data: campRow } = await supabase
    .from('campaigns')
    .select(
      'id, territory_id, monthly_total_cents, status, comp_until, created_at, ad:ads(id, title), advertiser:profiles!advertiser_id(id, full_name, email, phone)'
    )
    .eq('id', campaignId)
    .maybeSingle()
  if (!campRow) notFound()

  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)
  const raw = campRow as unknown as Record<string, unknown>
  const camp = {
    id: raw.id as string,
    territoryId: raw.territory_id as string,
    monthly: (raw.monthly_total_cents as number | null) ?? 0,
    status: raw.status as string,
    compUntil: raw.comp_until as string | null,
    createdAt: raw.created_at as string,
    ad: one(raw.ad as { id: string; title: string } | { id: string; title: string }[]),
    advertiser: one(
      raw.advertiser as
        | { id: string; full_name: string | null; email: string; phone: string | null }
        | { id: string; full_name: string | null; email: string; phone: string | null }[]
    ),
  }

  const billingRows = await loadBillingRows(camp.territoryId)
  const billing = billingRows.find((b) => b.campaignId === campaignId)?.billing ?? null

  const [{ data: payRows }, { data: placeRows }] = await Promise.all([
    supabase.from('payments').select('amount_cents, paid_at').eq('campaign_id', campaignId),
    supabase
      .from('ad_placements')
      .select('tv:tvs(id, venue:venues(id, name))')
      .eq('campaign_id', campaignId)
      .eq('status', 'active'),
  ])

  const payments = (payRows ?? []) as { amount_cents: number; paid_at: string }[]
  const collected = payments.reduce((s, p) => s + (p.amount_cents ?? 0), 0)
  const lastPaid = payments.map((p) => p.paid_at).sort().at(-1) ?? null

  type TvRow = { id: string; venue: { id: string; name: string } | { id: string; name: string }[] | null }
  const tvs = ((placeRows ?? []) as unknown as { tv: TvRow | TvRow[] | null }[])
    .map((p) => one(p.tv))
    .filter((t): t is TvRow => !!t)
  const venueNames = [
    ...new Set(tvs.map((t) => one(t.venue)?.name).filter((n): n is string => !!n)),
  ].sort()

  // What they have actually received for the money we did not collect.
  let plays = 0
  if (camp.ad) {
    const { count } = await supabase
      .from('ad_plays')
      .select('*', { count: 'exact', head: true })
      .eq('ad_id', camp.ad.id)
      .gte('played_at', sinceISO)
    plays = count ?? 0
  }

  const name = camp.advertiser?.full_name ?? camp.advertiser?.email ?? 'This account'
  const monthsRunning = Math.max(
    1,
    Math.round((Date.now() - new Date(camp.createdAt).getTime()) / (30 * DAY_MS))
  )
  const freeValue = camp.monthly * monthsRunning - collected

  const isComp = billing?.method === 'comp'
  const isUnbilled = billing?.method === 'unbilled'

  const verdict =
    kind === 'free-rider'
      ? isComp
        ? `${name} is running comped${camp.compUntil ? ` until ${formatDateTime(camp.compUntil)}` : ''}. They have been on ${tvs.length} screen${tvs.length === 1 ? '' : 's'} for about ${monthsRunning} month${monthsRunning === 1 ? '' : 's'} and have been shown ${formatNumber(plays)} times in the last 30 days.`
        : `${name} is on ${tvs.length} screen${tvs.length === 1 ? '' : 's'} with nothing set up to bill them. This is not a comp anyone decided on — it is an account that was never switched to paying.`
      : `${name} owes us. ${billing?.summary ?? 'No billing state on file.'} They are still on ${tvs.length} screen${tvs.length === 1 ? '' : 's'} while it is outstanding.`

  return (
    <CaseShell
      severity={kind === 'money-overdue' || isUnbilled ? 'critical' : 'opening'}
      title={name}
      verdict={verdict}
      moneyCents={camp.monthly}
      moneyNote={isComp ? 'given away each month' : 'per month not collected'}
    >
      <EvidenceGrid>
        <Evidence
          label="Billing"
          value={billing?.summary ?? 'Unknown'}
          note={billing ? `method: ${billing.method}` : 'no subscription or payment on file'}
          tone={billing?.health === 'ok' ? 'good' : billing?.health === 'due' ? 'warn' : 'bad'}
        />
        <Evidence
          label="Collected ever"
          value={formatCents(collected)}
          note={lastPaid ? `last payment ${timeAgo(lastPaid)}` : 'no payment ever recorded'}
          tone={collected === 0 ? 'bad' : undefined}
        />
        <Evidence
          label="Given away"
          value={formatCents(Math.max(0, freeValue))}
          note={`~${monthsRunning} month${monthsRunning === 1 ? '' : 's'} at ${formatCents(camp.monthly)}`}
          tone={freeValue > 0 ? 'warn' : undefined}
        />
        <Evidence
          label="Delivered 30d"
          value={formatNumber(plays)}
          note={`plays across ${tvs.length} screen${tvs.length === 1 ? '' : 's'}`}
        />
      </EvidenceGrid>

      <CaseSection title="What they are getting">
        <div className="rounded-lg border border-border px-3 py-2.5 text-sm">
          {venueNames.length ? (
            <>
              <p className="font-medium">{camp.ad?.title ?? 'Their ad'}</p>
              <p className="mt-0.5 text-muted-foreground">
                Running at {venueNames.join(', ')} — {tvs.length} screen
                {tvs.length === 1 ? '' : 's'}, shown {formatNumber(plays)} times in the last 30 days.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              Not on any screen right now, so nothing is being given away today — but the campaign
              is still open.
            </p>
          )}
        </div>
      </CaseSection>

      <CaseSection title="What to do">
        <CaseActions>
          {isComp && (
            <CaseAction
              href={`/admin/money?campaign=${camp.id}`}
              label="Convert them to paid"
              detail={`They have had ${formatNumber(plays)} plays in 30 days. That is the number to put in front of them, before the comp runs out.`}
            />
          )}
          {isUnbilled && (
            <CaseAction
              href={`/admin/money?campaign=${camp.id}`}
              label="Set up billing"
              detail="They are on screens and nothing is charging them. Either bill it or comp it on purpose."
            />
          )}
          {kind === 'money-overdue' && (
            <CaseAction
              href={`/admin/money?campaign=${camp.id}`}
              label="Record the payment or chase it"
              detail={billing?.summary ?? 'Mark it paid, or send the invoice again.'}
            />
          )}
          {camp.advertiser?.phone && (
            <CaseAction
              href={`tel:${camp.advertiser.phone}`}
              external
              label={`Call ${name}`}
              detail={camp.advertiser.phone}
            />
          )}
          {camp.advertiser?.email && (
            <CaseAction
              href={`mailto:${camp.advertiser.email}`}
              external
              label="Email them"
              detail={camp.advertiser.email}
            />
          )}
          <CaseAction
            href={camp.advertiser?.id ? `/admin/advertisers/${camp.advertiser.id}` : '/admin/advertisers'}
            label="Open the advertiser"
            detail="Their whole history with us, in one place."
          />
        </CaseActions>
      </CaseSection>
    </CaseShell>
  )
}

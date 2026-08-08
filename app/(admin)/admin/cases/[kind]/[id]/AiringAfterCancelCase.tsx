import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatCents, formatNumber, formatDateTime } from '@/lib/format'
import {
  CaseShell,
  CaseSection,
  Evidence,
  EvidenceGrid,
  CaseAction,
  CaseActions,
} from '@/components/admin/CaseShell'

// An ad still playing for a campaign that ended.
//
// Cancelling a campaign does not reliably end its placements, so the ad keeps
// airing. That costs twice: we deliver to someone who left, and the spot cannot
// be sold to anyone who would pay for it. It also quietly makes every occupancy
// number wrong — the network reads as fuller than it is, which is the worst way
// to be wrong when the job is filling it.

const DAY_MS = 86_400_000

export async function AiringAfterCancelCase({ campaignId }: { campaignId: string }) {
  const supabase = await createClient()

  const { data: campRow } = await supabase
    .from('campaigns')
    .select(
      'id, status, deleted_at, monthly_total_cents, updated_at, ad:ads(id, title, status), advertiser:profiles!advertiser_id(id, full_name, email, phone)'
    )
    .eq('id', campaignId)
    .maybeSingle()
  if (!campRow) notFound()

  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
  const raw = campRow as unknown as Record<string, unknown>
  const camp = {
    status: raw.status as string,
    deletedAt: raw.deleted_at as string | null,
    monthly: (raw.monthly_total_cents as number | null) ?? 0,
    endedAt: (raw.deleted_at as string | null) ?? (raw.updated_at as string),
    ad: one(raw.ad as { id: string; title: string; status: string }),
    advertiser: one(
      raw.advertiser as { id: string; full_name: string | null; email: string; phone: string | null }
    ),
  }

  const { data: placeRows } = await supabase
    .from('ad_placements')
    .select('id, tv:tvs(id, venue:venues(id, name))')
    .eq('campaign_id', campaignId)
    .eq('status', 'active')

  type PRow = { id: string; tv: { id: string; venue: { id: string; name: string } | null } | null }
  const places = ((placeRows ?? []) as unknown as PRow[])
    .map((p) => ({ id: p.id, tv: one(p.tv) }))
    .filter((p) => p.tv)
  const venues = [
    ...new Set(places.map((p) => one(p.tv!.venue)?.name).filter((n): n is string => !!n)),
  ].sort()

  // How much has actually gone out since it ended.
  let playsSince = 0
  if (camp.ad && camp.endedAt) {
    const { count } = await supabase
      .from('ad_plays')
      .select('*', { count: 'exact', head: true })
      .eq('ad_id', camp.ad.id)
      .gte('played_at', camp.endedAt)
    playsSince = count ?? 0
  }
  const daysSince = camp.endedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(camp.endedAt).getTime()) / DAY_MS))
    : null

  const name = camp.advertiser?.full_name ?? camp.advertiser?.email ?? 'This advertiser'
  const ended = camp.deletedAt ? 'deleted' : camp.status

  return (
    <CaseShell
      severity="critical"
      title={name}
      verdict={`Their campaign was ${ended}${daysSince != null ? ` about ${daysSince} day${daysSince === 1 ? '' : 's'} ago` : ''}, and "${camp.ad?.title ?? 'their ad'}" is still on ${places.length} screen${places.length === 1 ? '' : 's'}. It has played ${formatNumber(playsSince)} times since. Every one of those spots is unsellable while it sits there.`}
      moneyCents={camp.monthly}
      moneyNote="what they used to pay"
    >
      <EvidenceGrid>
        <Evidence
          label="Campaign"
          value={ended}
          note={camp.endedAt ? formatDateTime(camp.endedAt) : 'no end date recorded'}
          tone="bad"
        />
        <Evidence
          label="Still on"
          value={`${places.length} screen${places.length === 1 ? '' : 's'}`}
          note={venues.join(', ') || 'no venue resolved'}
          tone="bad"
        />
        <Evidence
          label="Played since"
          value={formatNumber(playsSince)}
          note="delivered after it ended"
          tone={playsSince > 0 ? 'warn' : undefined}
        />
        <Evidence
          label="Ad status"
          value={camp.ad?.status ?? '—'}
          note={camp.ad?.status === 'active' ? 'still approved to run' : 'not airing by status'}
        />
      </EvidenceGrid>

      <CaseSection title="Why it is still there">
        <div className="rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground">
          Cancelling a campaign ends the billing but does not always end its
          <code className="mx-1 rounded bg-muted px-1 text-xs">ad_placements</code> rows, and the
          placement engine only fills empty slots — it does not clear occupied ones. So the ad
          stays in the loop until someone removes it by hand. Until then the spot counts as sold
          everywhere in the admin, which makes the open-inventory number on Sell too low.
        </div>
      </CaseSection>

      <CaseSection title="What to do">
        <CaseActions>
          {places.map((p) => {
            const venue = one(p.tv!.venue)
            return (
              <CaseAction
                key={p.id}
                href={`/admin/tvs/${p.tv!.id}`}
                label={`Clear it from ${venue?.name ?? 'this screen'}`}
                detail="Open the screen and remove the placement. That frees the spot and stops the delivery."
              />
            )
          })}
          {camp.advertiser?.phone && (
            <CaseAction
              href={`tel:${camp.advertiser.phone}`}
              external
              label={`Call ${name}`}
              detail={`${camp.advertiser.phone} — they have been running free since they cancelled. Worth asking whether they want to come back before you pull it.`}
            />
          )}
          <CaseAction
            href="/admin/sell"
            label="Sell the spots it frees"
            detail={`${places.length} spot${places.length === 1 ? '' : 's'} at ${venues.join(', ') || 'these venues'} become sellable the moment this is cleared.`}
          />
        </CaseActions>
      </CaseSection>
    </CaseShell>
  )
}

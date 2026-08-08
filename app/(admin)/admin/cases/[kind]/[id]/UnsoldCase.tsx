import { notFound } from 'next/navigation'
import { formatCents, formatNumber } from '@/lib/format'
import { loadInventory } from '@/lib/inventory'
import {
  CaseShell,
  CaseSection,
  Evidence,
  EvidenceGrid,
  CaseAction,
  CaseActions,
} from '@/components/admin/CaseShell'

// A venue that is already working and still half empty.
//
// This is the only case on the board that is not a fault. It is here because the
// network is a few percent sold, and an empty slot on a screen that is already
// powered, paired and checking in is the cheapest revenue in the business — it
// costs nothing more to deliver than the one next to it.

export async function UnsoldCase({ venueId }: { venueId: string }) {
  // Not territory-scoped: you reached this from a case that already resolved the
  // venue, and a detail page that 404s because of a territory switch is a bug.
  const { rows } = await loadInventory(null)
  const v = rows.find((r) => r.venueId === venueId)
  if (!v) notFound()

  const pctSold = v.totalSlots > 0 ? Math.round((v.sold / v.totalSlots) * 100) : 0

  return (
    <CaseShell
      severity="opening"
      title={v.name}
      verdict={`${v.open} of ${v.totalSlots} spots here are empty on ${v.liveScreens} screen${v.liveScreens === 1 ? '' : 's'} that ${v.liveScreens === 1 ? 'is' : 'are'} already live and checking in. Filling them costs nothing extra to deliver.`}
      moneyCents={v.openValueCents}
      moneyNote="per month sitting empty"
    >
      <EvidenceGrid>
        <Evidence
          label="Open spots"
          value={`${v.open}/${v.totalSlots}`}
          note={`${pctSold}% sold`}
          tone={pctSold < 50 ? 'warn' : undefined}
        />
        <Evidence
          label="Worth"
          value={formatCents(v.openValueCents)}
          note={`${formatCents(v.priceCents)} per spot · ${v.tierLabel}`}
        />
        <Evidence
          label="Live screens"
          value={String(v.liveScreens)}
          note={`${v.screens.length} paired here`}
          tone={v.liveScreens === 0 ? 'bad' : 'good'}
        />
        <Evidence
          label="Est. reach"
          value={`~${formatNumber(v.footTraffic)}`}
          note="people a month, venue's own figure"
        />
      </EvidenceGrid>

      <CaseSection title="Screen by screen">
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {v.screens.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">Screen {i + 1}</div>
                <p className="text-xs text-muted-foreground">
                  {s.paired ? (s.live ? 'Checking in' : 'Paired but dark') : 'Never paired'}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-sm tabular-nums">
                  {s.sold}/{s.slots}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {s.open} open
                </div>
              </div>
            </div>
          ))}
        </div>
      </CaseSection>

      <CaseSection
        title="Who is already here"
        note={v.ownCategory ? `venue's own line of business: ${v.ownCategory}` : undefined}
      >
        <div className="rounded-lg border border-border px-3 py-2.5 text-sm">
          {v.runningTitles.length ? (
            <>
              <p>{v.runningTitles.join(', ')}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Do not pitch a competitor of these, or of the venue itself — exclusivity is what the
                host is protecting.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              Nobody is running here yet. The first advertiser in gets the whole room to themselves.
            </p>
          )}
        </div>
      </CaseSection>

      <CaseSection title="What to do">
        <CaseActions>
          <CaseAction
            href="/admin/sell"
            label="Work the open inventory"
            detail="Every venue with space, richest first, with the categories already taken."
          />
          <CaseAction
            href="/admin/pipeline"
            label="Put a name against these spots"
            detail="Open the pipeline and add the businesses you would put on this screen."
          />
          {v.contact.phone && (
            <CaseAction
              href={`tel:${v.contact.phone}`}
              external
              label={`Call ${v.contact.name ?? v.name}`}
              detail={`${v.contact.phone} — hosts refer their own suppliers faster than cold outreach works.`}
            />
          )}
          <CaseAction
            href={`/admin/venues/${v.venueId}`}
            label="Open the venue"
            detail="Hours, screens, host agreement and pricing tier."
          />
        </CaseActions>
      </CaseSection>
    </CaseShell>
  )
}

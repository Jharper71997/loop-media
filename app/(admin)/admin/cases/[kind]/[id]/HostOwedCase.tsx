import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { loadHostBenefits } from '@/lib/hostBenefit'
import { FREE_SCREENS_PER_HOSTED_TV } from '@/lib/hostComp'
import {
  CaseShell,
  CaseSection,
  Evidence,
  EvidenceGrid,
  CaseAction,
  CaseActions,
} from '@/components/admin/CaseShell'

// A host who is not getting what hosting earns them.
//
// Two free advertising screens for every screen they put in their establishment.
// That is consideration in an agreement, not a discount — which is why this case
// carries no dollar figure. Nothing is at risk; something is owed. The only
// number that matters is the gap, and the only action is to close it.

export async function HostOwedCase({ hostId }: { hostId: string }) {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const benefits = await loadHostBenefits(territory.activeId)
  const b = benefits.find((x) => x.hostId === hostId)
  if (!b) notFound()

  return (
    <CaseShell
      severity="opening"
      title={b.name}
      verdict={
        b.using === 0
          ? `${b.name} hosts ${b.hostedTvs} screen${b.hostedTvs === 1 ? '' : 's'} for us at ${b.venueNames.join(', ')} and is running none of the ${b.owed} free advertising screens that earns. We are taking the room and giving back nothing.`
          : `${b.name} is running ${b.using} free screen${b.using === 1 ? '' : 's'} against an allowance of ${b.owed} — two for each of the ${b.hostedTvs} screen${b.hostedTvs === 1 ? '' : 's'} they host. They are ${b.gap} short.`
      }
    >
      <EvidenceGrid>
        <Evidence
          label="Screens hosted"
          value={String(b.hostedTvs)}
          note={b.venueNames.join(', ')}
        />
        <Evidence
          label="Free screens earned"
          value={String(b.owed)}
          note={`${FREE_SCREENS_PER_HOSTED_TV} per screen they host`}
        />
        <Evidence
          label="Actually running"
          value={String(b.using)}
          note={b.using === 0 ? 'none of it taken up' : 'free screens on air'}
          tone={b.using === 0 ? 'bad' : 'warn'}
        />
        <Evidence
          label="Short by"
          value={String(b.gap)}
          note="screens we owe them"
          tone="warn"
        />
      </EvidenceGrid>

      <CaseSection title="Why this matters">
        <div className="rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground">
          <p>
            The perk is a 100%-off code minted when their venue went live
            {b.compCode ? (
              <>
                {' '}
                — theirs is{' '}
                <span className="font-mono font-medium text-foreground">{b.compCode}</span>
              </>
            ) : (
              ', and this venue has none on file'
            )}
            . It applies itself at checkout, but only if the host ever goes and starts a campaign.
            Nothing in the product asks them to, and nothing checked whether they had — so a host
            can sit for months giving us a screen and receiving nothing, which is exactly the
            relationship you do not want when it comes time to renew or add a second TV.
          </p>
        </div>
      </CaseSection>

      <CaseSection title="What to do">
        <CaseActions>
          <CaseAction
            href="/admin/deals/new"
            label="Set their free screens up for them"
            detail={`Build the campaign on their behalf and comp it. ${b.gap} screen${b.gap === 1 ? '' : 's'} to place, at no charge.`}
          />
          {b.phone && (
            <CaseAction
              href={`tel:${b.phone}`}
              external
              label={`Call ${b.name}`}
              detail={`${b.phone} — tell them what they have sitting unused. This is a good call to make, not an awkward one.`}
            />
          )}
          {b.email && (
            <CaseAction
              href={`mailto:${b.email}`}
              external
              label="Email them the perk"
              detail={`${b.email}${b.compCode ? ` — send the code ${b.compCode}` : ''}`}
            />
          )}
          {b.venueIds[0] && (
            <CaseAction
              href={`/admin/venues/${b.venueIds[0]}`}
              label="Open their venue"
              detail="Screens, hours, agreement and contact."
            />
          )}
        </CaseActions>
      </CaseSection>
    </CaseShell>
  )
}

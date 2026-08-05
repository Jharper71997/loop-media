import Link from 'next/link'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { PageHeader } from '@/components/admin/PageHeader'
import { HudBody } from '@/components/admin/hud'
import { loadBoard } from '@/lib/opportunities'
import { loadTemplates } from '@/lib/conversations'
import { stagesFor, stageLabel, sourceLabel, SOURCES, KIND_LABEL, type OpportunityKind } from '@/lib/pipeline'
import { OutreachForm, type Recipient } from './OutreachForm'
import { cn } from '@/lib/utils'

// Message a segment.
//
// The filter lives in the URL rather than in component state so a useful segment
// is a link you can bookmark: "every Brew Loop sponsor still sitting in New" is
// a list you will want again next month.

export default async function OutreachPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; stage?: string; source?: string }>
}) {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const { kind: kindParam, stage, source } = await searchParams
  const kind: OpportunityKind = kindParam === 'host' ? 'host' : 'advertiser'

  const [board, templates] = await Promise.all([loadBoard(t, kind), loadTemplates()])

  // Only open cards. Messaging a won or lost deal from a bulk tool is almost
  // always a mistake, and both have their own record page for one-offs.
  const all = board.columns.flatMap((c) => c.items)
  const filtered = all
    .filter((o) => !stage || o.stage === stage)
    .filter((o) => !source || (o.source ?? 'unknown') === source)

  const recipients: Recipient[] = filtered.map((o) => ({
    id: o.id,
    businessName: o.businessName,
    contactName: o.contactName,
    email: o.email,
    city: o.city,
    stageLabel: stageLabel(o.kind, o.stage),
  }))

  const usableTemplates = templates.filter(
    (x) => x.channel === 'email' && (x.audience === 'any' || x.audience === kind)
  )

  const stages = stagesFor(kind)
  const sourcesPresent = [...new Set(all.map((o) => o.source ?? 'unknown'))]

  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    const merged = { kind, stage, source, ...patch }
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v)
    return `/admin/pipeline/outreach?${p.toString()}`
  }

  return (
    <>
      <PageHeader
        title="Outreach"
        description={`${recipients.length} in this filter · ${KIND_LABEL[kind].toLowerCase()}`}
      />

      <HudBody>
        <Link
          href={`/admin/pipeline?kind=${kind}`}
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back to pipeline
        </Link>

        {!board.ready ? (
          <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            <AlertTriangle className="mt-px size-4 shrink-0 text-warning" />
            <p className="text-muted-foreground">
              The pipeline tables have not been created yet, so there is nobody to message.
            </p>
          </div>
        ) : (
          <>
            {/* ---- Filters ---- */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-3 py-2">
              <FilterGroup label="Board">
                {(['advertiser', 'host'] as OpportunityKind[]).map((k) => (
                  <Chip key={k} href={link({ kind: k, stage: undefined })} active={k === kind}>
                    {KIND_LABEL[k]}
                  </Chip>
                ))}
              </FilterGroup>

              <FilterGroup label="Stage">
                <Chip href={link({ stage: undefined })} active={!stage}>
                  Any
                </Chip>
                {stages.map((s) => (
                  <Chip key={s.key} href={link({ stage: s.key })} active={stage === s.key}>
                    {s.label}
                  </Chip>
                ))}
              </FilterGroup>

              {sourcesPresent.length > 1 && (
                <FilterGroup label="Source">
                  <Chip href={link({ source: undefined })} active={!source}>
                    Any
                  </Chip>
                  {SOURCES.filter((s) => sourcesPresent.includes(s.key)).map((s) => (
                    <Chip key={s.key} href={link({ source: s.key })} active={source === s.key}>
                      {s.label}
                    </Chip>
                  ))}
                  {sourcesPresent.includes('unknown') && (
                    <Chip href={link({ source: 'unknown' })} active={source === 'unknown'}>
                      {sourceLabel(null)}
                    </Chip>
                  )}
                </FilterGroup>
              )}
            </div>

            {recipients.length === 0 ? (
              <p className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                Nothing open matches this filter.
              </p>
            ) : (
              <OutreachForm recipients={recipients} templates={usableTemplates} />
            )}
          </>
        )}
      </HudBody>
    </>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

function Chip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-md px-2 py-0.5 text-[11px] transition-colors',
        active
          ? 'bg-primary/10 font-medium text-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
      {children}
    </Link>
  )
}

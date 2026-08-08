import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  MessageSquare,
  Phone,
  Mail,
  Users,
  Trophy,
  XCircle,
  ArrowRight,
  Plus,
} from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { PageHeader } from '@/components/admin/PageHeader'
import { HudBody, Panel } from '@/components/admin/hud'
import { Badge } from '@/components/ui/badge'
import { formatCents, formatDateTime, timeAgo } from '@/lib/format'
import { loadOpportunity } from '@/lib/opportunities'
import { loadThread, loadTemplates } from '@/lib/conversations'
import { smsEnabled } from '@/lib/messaging'
import { MessageThread } from '@/components/admin/MessageThread'
import {
  stageLabel,
  wonLabel,
  lostLabel,
  daysSince,
  EVENT_LABEL,
  type EventKind,
} from '@/lib/pipeline'
import {
  Field,
  SourceField,
  StagePicker,
  NextStepForm,
  Composer,
  CloseControls,
  DealHandoffLink,
} from './RecordControls'
import { cn } from '@/lib/utils'

// One prospect, everything about them.
//
// The layout answers the three questions in the order they get asked on a call:
// who are they and how do I reach them, what did we say last time, and what am I
// doing about it next.

const EVENT_ICON: Record<EventKind, typeof MessageSquare> = {
  created: Plus,
  note: MessageSquare,
  call: Phone,
  email: Mail,
  meeting: Users,
  stage: ArrowRight,
  won: Trophy,
  lost: XCircle,
}

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Templates are a fixed list that depends on nothing, so it has no business
  // waiting behind the record it will be rendered next to.
  const [profile, loaded, templates] = await Promise.all([
    requireAdmin(),
    loadOpportunity(id),
    loadTemplates(),
  ])
  if (!loaded) notFound()
  const { opportunity: o, events } = loaded

  // The thread follows the business across conversion: once an opportunity has
  // an advertiser account, messages sent before and after the sale are one
  // history rather than two. This one genuinely waits — it needs the advertiser
  // id the record carries.
  const thread = await loadThread({ opportunityId: o.id, advertiserId: o.advertiserId })

  const cold = daysSince(o.lastTouchAt)

  return (
    <>
      <PageHeader
        title={o.businessName}
        description={[
          o.kind === 'host' ? 'Host prospect' : 'Advertiser prospect',
          o.city,
          o.categoryName,
        ]
          .filter(Boolean)
          .join(' · ')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {o.status === 'open' && <StagePicker id={o.id} kind={o.kind} stage={o.stage} />}
            <CloseControls
              id={o.id}
              kind={o.kind}
              status={o.status}
              businessName={o.businessName}
            />
          </div>
        }
      />

      <HudBody>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/admin/pipeline?kind=${o.kind}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Back to pipeline
          </Link>

          {o.status === 'won' && (
            <Badge variant="success">
              {wonLabel(o.kind)}
              {o.wonAt && ` ${timeAgo(o.wonAt)}`}
            </Badge>
          )}
          {o.status === 'lost' && (
            <Badge variant="secondary">
              {lostLabel(o.kind)}
              {o.lostAt && ` ${timeAgo(o.lostAt)}`}
            </Badge>
          )}
          {o.status === 'open' && <Badge>{stageLabel(o.kind, o.stage)}</Badge>}
          {cold != null && o.status === 'open' && (
            <span className="text-[11px] text-muted-foreground">
              Last contact {cold === 0 ? 'today' : `${cold} days ago`}
            </span>
          )}

          {/* Once it converts, the card points at the live thing it became. */}
          {o.venueId && (
            <Link
              href={`/admin/venues/${o.venueId}`}
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <Building2 className="size-3" /> Open the venue
            </Link>
          )}
          {o.advertiserId && (
            <Link
              href={`/admin/advertisers/${o.advertiserId}`}
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <ExternalLink className="size-3" /> Open the account
            </Link>
          )}
          {o.status === 'won' && o.kind === 'advertiser' && !o.campaignId && (
            <DealHandoffLink id={o.id} />
          )}
        </div>

        {o.status === 'lost' && o.lostReason && (
          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Why it was {lostLabel(o.kind).toLowerCase()}
            </p>
            <p className="mt-0.5 text-[13px]">{o.lostReason}</p>
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-3">
          <div className="grid content-start gap-3 lg:col-span-2">
          {/* ---- Messages ---- */}
          <Panel
            title="Messages"
            note={thread.messages.length > 0 ? `${thread.messages.length} in thread` : undefined}
          >
            <MessageThread
              opportunityId={o.id}
              advertiserId={o.advertiserId}
              email={o.email}
              phone={o.phone}
              templates={templates.filter((t) => t.audience === 'any' || t.audience === o.kind)}
              messages={thread.messages}
              ready={thread.ready}
              smsOn={smsEnabled()}
              context={{
                business: o.businessName,
                contact: o.contactName,
                city: o.city,
                myName: profile.full_name,
              }}
            />
          </Panel>

          {/* ---- Activity ---- */}
          <Panel
            title="Activity"
            note={`${events.length} entr${events.length === 1 ? 'y' : 'ies'}`}
          >
            <Composer id={o.id} />

            <ul className="mt-3 space-y-2 border-t border-border pt-3">
              {events.length === 0 ? (
                <li className="py-4 text-center text-xs text-muted-foreground">
                  Nothing logged yet.
                </li>
              ) : (
                events.map((e) => {
                  const Icon = EVENT_ICON[e.kind] ?? MessageSquare
                  return (
                    <li key={e.id} className="flex gap-2">
                      <Icon
                        className={cn(
                          'mt-0.5 size-3.5 shrink-0',
                          e.kind === 'won' && 'text-success',
                          e.kind === 'lost' && 'text-destructive',
                          e.kind !== 'won' && e.kind !== 'lost' && 'text-muted-foreground'
                        )}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {EVENT_LABEL[e.kind] ?? e.kind}
                          </span>
                          {e.kind === 'stage' && e.toStage && (
                            <>
                              {' '}
                              {e.fromStage ? `${stageLabel(o.kind, e.fromStage)} → ` : ''}
                              {stageLabel(o.kind, e.toStage)}
                            </>
                          )}
                          {' · '}
                          {formatDateTime(e.createdAt)}
                          {e.authorName && ` · ${e.authorName}`}
                        </p>
                        {e.body && (
                          <p className="mt-0.5 whitespace-pre-wrap text-[13px]">{e.body}</p>
                        )}
                      </div>
                    </li>
                  )
                })
              )}
            </ul>
          </Panel>
          </div>

          {/* ---- Who they are, what it's worth, what's next ---- */}
          <div className="grid content-start gap-3">
            <Panel title="Next step">
              {o.status === 'open' ? (
                <NextStepForm id={o.id} nextStep={o.nextStep} nextStepAt={o.nextStepAt} />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Closed deals do not carry a follow-up. Move it back to a stage to reopen.
                </p>
              )}
            </Panel>

            <Panel title="Contact" bodyClassName="p-0">
              <div className="divide-y divide-border">
                <Field id={o.id} field="businessName" label="Business" value={o.businessName} />
                <Field id={o.id} field="contactName" label="Contact" value={o.contactName} />
                <Field
                  id={o.id}
                  field="phone"
                  label="Phone"
                  value={o.phone}
                  href={o.phone ? `tel:${o.phone}` : null}
                />
                <Field
                  id={o.id}
                  field="email"
                  label="Email"
                  value={o.email}
                  href={o.email ? `mailto:${o.email}` : null}
                />
                <Field id={o.id} field="city" label="City" value={o.city} />
                <Field id={o.id} field="address" label="Address" value={o.address} />
                <Field
                  id={o.id}
                  field="website"
                  label="Website"
                  value={o.website}
                  href={o.website ?? null}
                />
              </div>
            </Panel>

            <Panel title="The deal" bodyClassName="p-0">
              <div className="divide-y divide-border">
                <Field
                  id={o.id}
                  field="monthlyCents"
                  label="Per month"
                  value={o.monthlyCents}
                  kind="money"
                  placeholder="$0"
                />
                <Field
                  id={o.id}
                  field="screens"
                  label={o.kind === 'host' ? 'Screens they take' : 'Locations'}
                  value={o.screens}
                  kind="number"
                />
                <SourceField id={o.id} value={o.source} />
                <div className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    {o.kind === 'host' ? 'They sell' : 'Category'}
                  </span>
                  <span className="truncate text-[13px]">
                    {o.categoryName ?? (
                      <span className="italic text-muted-foreground/70">Not set</span>
                    )}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                  <span className="text-[11px] text-muted-foreground">Added</span>
                  <span className="font-mono text-[13px] tabular-nums">
                    {formatDateTime(o.createdAt)}
                  </span>
                </div>
              </div>
              {o.kind === 'host' && o.categoryName && (
                <p className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
                  Host protection: you will never be able to sell {o.categoryName} into this venue.
                </p>
              )}
            </Panel>

            {o.monthlyCents > 0 && (
              <p className="px-1 text-[10px] text-muted-foreground">
                Worth {formatCents(o.monthlyCents * 12)} a year if it closes and holds.
              </p>
            )}
          </div>
        </div>
      </HudBody>
    </>
  )
}

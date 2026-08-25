import Link from 'next/link'
import { Phone, PhoneMissed, MessageSquare, Mail, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, SELL_TABS } from '@/components/admin/SectionTabs'
import { EmptyState } from '@/components/admin/EmptyState'
import { HudBody, StatStrip, Stat } from '@/components/admin/hud'
import { formatDateTime, timeAgo } from '@/lib/format'
import { formatPhone } from '@/lib/quo'
import { loadCommsLog, type CommsItem } from '@/lib/commsLog'
import { cn } from '@/lib/utils'

// Activity — every call, text and email, newest first.
//
// A record's thread answers "what have we said to this business". Nothing
// answered "what happened today", and nothing at all surfaced a call from a
// number we do not have on file. That call is a lead: someone rang the business
// number and there was no trace of it anywhere.
//
// Calls and texts arrive here on their own, from the Quo webhook — they are not
// logged by hand, so this page is a record of what happened rather than a record
// of what somebody remembered to write down.

function Icon({ i }: { i: CommsItem }) {
  if (i.channel === 'call')
    return i.answered ? (
      <Phone className="size-3.5 shrink-0 text-success" aria-hidden />
    ) : (
      <PhoneMissed className="size-3.5 shrink-0 text-destructive" aria-hidden />
    )
  if (i.channel === 'sms') return <MessageSquare className="size-3.5 shrink-0" aria-hidden />
  return <Mail className="size-3.5 shrink-0" aria-hidden />
}

function label(i: CommsItem): string {
  if (i.channel === 'call') return i.direction === 'in' ? 'Call in' : 'Call out'
  if (i.channel === 'sms') return i.direction === 'in' ? 'Text in' : 'Text out'
  return i.direction === 'in' ? 'Email in' : 'Email out'
}

export default async function ActivityPage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const { ready, items, summary } = await loadCommsLog(territory.activeId)

  return (
    <>
      <PageHeader
        title="Activity"
        description={
          ready
            ? `${items.length} on record · ${summary.recent} in the last 24 hours`
            : 'Not set up yet'
        }
      />
      <SectionTabs tabs={SELL_TABS} />

      <HudBody>
        <StatStrip cols={3}>
          <Stat
            label="Last 24 hours"
            value={String(summary.recent)}
            sub={`${summary.recentCalls} call${summary.recentCalls === 1 ? '' : 's'}`}
          />
          <Stat
            label="Missed calls"
            value={String(summary.missed)}
            sub="somebody rang and got nobody"
            tone={summary.missed > 0 ? 'warn' : undefined}
          />
          <Stat
            label="Numbers you don't have"
            value={String(summary.unknown)}
            sub="not matched to any record"
            tone={summary.unknown > 0 ? 'warn' : undefined}
            title="A call or text from a number that matches no prospect and no advertiser. Usually a lead."
          />
        </StatStrip>

        {!ready ? (
          <EmptyState
            title="Call and text logging is not switched on."
            hint="Needs migration 0074 applied and QUO_WEBHOOK_SECRET set, with a webhook in Quo pointing at /api/quo/webhook."
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="Nothing on record yet."
            hint="Calls and texts appear here on their own once the Quo webhook is connected. Emails sent from a record's thread land here too."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <ul className="divide-y divide-border">
              {items.map((i) => {
                const row = (
                  <div className="flex items-start gap-3 px-3 py-3 md:py-2.5">
                    <div className="mt-0.5 flex shrink-0 items-center gap-1.5 text-muted-foreground">
                      <Icon i={i} />
                      {i.direction === 'in' ? (
                        <ArrowDownLeft className="size-3 text-success" aria-hidden />
                      ) : (
                        <ArrowUpRight className="size-3" aria-hidden />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="truncate text-sm font-medium">{i.who}</span>
                        {i.unknown && (
                          <span className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                            Not in the system
                          </span>
                        )}
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {label(i)} · {timeAgo(i.createdAt)}
                        </span>
                      </div>
                      {i.subject && <p className="text-xs font-medium">{i.subject}</p>}
                      <p className="line-clamp-2 text-xs text-muted-foreground">{i.body}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                        {formatDateTime(i.createdAt)}
                        {i.contactPhone ? ` · ${formatPhone(i.contactPhone)}` : ''}
                      </p>
                    </div>
                  </div>
                )
                return (
                  <li key={i.id} className={cn(i.unknown && 'bg-warning/5')}>
                    {i.href ? (
                      <Link href={i.href} className="block hover:bg-muted/50">
                        {row}
                      </Link>
                    ) : (
                      row
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </HudBody>
    </>
  )
}

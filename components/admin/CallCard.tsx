'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Phone, MessageSquare, Mail, Check, Clock, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { formatCents } from '@/lib/format'
import { type CallEntry } from '@/lib/callList'
import { logTouch, pushFollowUp } from '@/app/(admin)/admin/sell/actions'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

// One call, as a card you can actually work from a phone.
//
// The old sell page put the phone number in 11px grey text at the end of a row
// of eight other facts, as a `tel:` link you had to hit precisely. On a phone
// that is not a call button, it is a target. Here the three ways to reach
// someone are full-height buttons across the bottom of the card, and the two
// outcomes that change the list — you called them, or you are moving it — are
// the only other controls.

const REASON_TONE: Record<CallEntry['reason'], string> = {
  promised: 'bg-destructive',
  'going-cold': 'bg-warning',
  'has-room': 'bg-primary',
  owed: 'bg-muted-foreground/40',
}

/** Strip everything a dialler will not take. */
const dial = (p: string) => p.replace(/[^\d+]/g, '')

export function CallCard({ c }: { c: CallEntry }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  // Only a pipeline row has somewhere to record the outcome. A venue with open
  // spots and a host we owe are computed from live data — they leave the list
  // when the underlying fact changes, not when you tick them.
  const oppId = c.id.startsWith('opp:') ? c.id.slice(4) : null

  function act(fn: () => Promise<{ error: string | null }>, msg: string) {
    start(async () => {
      const res = await fn()
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(msg)
      router.refresh()
    })
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-start gap-3 p-3">
        <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', REASON_TONE[c.reason])} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <Link href={c.href} className="truncate text-sm font-medium hover:underline">
              {c.name}
            </Link>
            {c.overdue && (
              <span className="shrink-0 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive">
                Late
              </span>
            )}
          </div>
          {c.contactName && c.contactName !== c.name && (
            <p className="text-xs text-foreground/80">{c.contactName}</p>
          )}
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{c.why}</p>
        </div>
        {c.moneyCents > 0 && (
          <div className="shrink-0 text-right">
            <div className="font-mono text-sm tabular-nums">{formatCents(c.moneyCents)}</div>
            <div className="text-[10px] text-muted-foreground">/mo</div>
          </div>
        )}
      </div>

      {/* Reach them. Full-width targets, because this is the point of the card. */}
      <div className="flex divide-x divide-border border-t border-border">
        <Reach
          href={c.phone ? `tel:${dial(c.phone)}` : null}
          icon={<Phone className="size-4" />}
          label="Call"
        />
        <Reach
          href={c.phone ? `sms:${dial(c.phone)}` : null}
          icon={<MessageSquare className="size-4" />}
          label="Text"
        />
        <Reach
          href={c.email ? `mailto:${c.email}` : null}
          icon={<Mail className="size-4" />}
          label="Email"
        />
        {oppId ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => act(() => logTouch(oppId), `${c.name} · marked reached`)}
              className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <Check className="size-4" /> Reached
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={pending}
                aria-label="Move this follow-up"
                className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <Clock className="size-4" /> Later
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Follow up in</DropdownMenuLabel>
                {[
                  { d: 1, l: 'Tomorrow' },
                  { d: 3, l: '3 days' },
                  { d: 7, l: 'A week' },
                  { d: 30, l: 'A month' },
                ].map((o) => (
                  <DropdownMenuItem
                    key={o.d}
                    onClick={() => act(() => pushFollowUp(oppId, o.d), `${c.name} · ${o.l}`)}
                  >
                    {o.l}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <Link
            href={c.href}
            className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Open <ChevronRight className="size-3.5" />
          </Link>
        )}
      </div>
    </div>
  )
}

/** A contact button, or a dead one that says why rather than vanishing. */
function Reach({
  href,
  icon,
  label,
}: {
  href: string | null
  icon: React.ReactNode
  label: string
}) {
  if (!href) {
    return (
      <span
        title={`No ${label.toLowerCase()} on file`}
        className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs text-muted-foreground/35"
      >
        {icon} {label}
      </span>
    )
  }
  return (
    <a
      href={href}
      className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {icon} {label}
    </a>
  )
}

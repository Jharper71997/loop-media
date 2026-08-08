// A dated history for every record, assembled at read time.
//
// Only one page in the whole admin had a timeline — the pipeline record, backed
// by opportunity_events. Everywhere else, "what happened to this account" was
// unanswerable, even though the app has been writing the answer down for months
// in tables nothing ever read: tv_alerts (every offline email sent to a host),
// report_log and host_report_log (every monthly report), placement_exclusions
// (every ad you pulled off a screen by hand), payments, messages.
//
// The alternative was a generic audit_log plus a logEvent() call in ~40 server
// actions. That is the better long-run answer and the wrong first move: it needs
// a migration behind two that are already unapplied, and it would show an empty
// panel on every record until enough time passed to fill it. A union over what
// already exists is retroactive — history appears the day it ships — and needs
// no schema change at all.
//
// It cannot record what leaves no row (who edited a price, who changed business
// hours). Those stay invisible until there is an audit_log; everything below is
// something the system already remembers.
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { formatCents } from '@/lib/format'

// This repo ships features ahead of their migrations (see lib/settings.server.ts),
// and 0069 — which creates `messages` — is written but not applied, so that source
// currently 404s in the schema cache. A timeline is additive by nature: a source
// that cannot answer contributes nothing and the rest of the history still shows.
// So every query here degrades to no events rather than taking the record down.

export type ActivityKind =
  | 'payment'
  | 'message'
  | 'ad'
  | 'campaign'
  | 'report'
  | 'alert'
  | 'placement'
  | 'note'

export interface ActivityEvent {
  at: string
  kind: ActivityKind
  title: string
  detail?: string
  href?: string
}

export type ActivitySubject =
  | { kind: 'advertiser'; id: string }
  | { kind: 'venue'; id: string }
  | { kind: 'screen'; id: string }

const MAX_EVENTS = 60

/** Run a query; any failure contributes no events instead of throwing. */
async function safe<T>(
  p: PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  try {
    const { data, error } = await p
    return error ? [] : (data ?? [])
  } catch {
    return []
  }
}

export const loadActivity = cache(
  async (subject: ActivitySubject): Promise<ActivityEvent[]> => {
    const supabase = await createClient()
    const out: ActivityEvent[] = []

    if (subject.kind === 'advertiser') {
      const [payments, ads, campaigns, messages] = await Promise.all([
        safe(
          supabase
            .from('payments')
            .select('amount_cents, source, paid_at')
            .eq('advertiser_id', subject.id)
            .order('paid_at', { ascending: false })
            .limit(MAX_EVENTS)
        ),
        safe(
          supabase
            .from('ads')
            .select('id, title, status, created_at, reviewed_at, rejection_reason')
            .eq('owner_user_id', subject.id)
            .order('created_at', { ascending: false })
            .limit(MAX_EVENTS)
        ),
        safe(
          supabase
            .from('campaigns')
            .select('id, status, monthly_total_cents, comp_until, created_at')
            .eq('advertiser_id', subject.id)
            .order('created_at', { ascending: false })
            .limit(MAX_EVENTS)
        ),
        safe(
          supabase
            .from('messages')
            .select('direction, channel, subject, body, created_at')
            .eq('advertiser_id', subject.id)
            .order('created_at', { ascending: false })
            .limit(MAX_EVENTS)
        ),
      ])

      for (const p of payments as { amount_cents: number; source: string; paid_at: string }[]) {
        out.push({
          at: p.paid_at,
          kind: 'payment',
          title: `Paid ${formatCents(p.amount_cents)}`,
          detail: p.source,
        })
      }
      for (const a of ads as {
        id: string
        title: string
        status: string
        created_at: string
        reviewed_at: string | null
        rejection_reason: string | null
      }[]) {
        out.push({ at: a.created_at, kind: 'ad', title: `Submitted "${a.title}"` })
        if (a.reviewed_at) {
          out.push({
            at: a.reviewed_at,
            kind: 'ad',
            title: a.status === 'rejected' ? `Rejected "${a.title}"` : `Approved "${a.title}"`,
            detail: a.rejection_reason ?? undefined,
          })
        }
      }
      for (const c of campaigns as {
        id: string
        status: string
        monthly_total_cents: number | null
        comp_until: string | null
        created_at: string
      }[]) {
        out.push({
          at: c.created_at,
          kind: 'campaign',
          title: c.comp_until
            ? 'Campaign started, comped'
            : `Campaign started at ${formatCents(c.monthly_total_cents ?? 0)}/mo`,
          detail: `now ${c.status}`,
        })
      }
      for (const m of messages as {
        direction: string
        channel: string
        subject: string | null
        body: string
        created_at: string
      }[]) {
        out.push({
          at: m.created_at,
          kind: 'message',
          title: `${m.direction === 'in' ? 'They sent' : 'We sent'} ${m.channel === 'sms' ? 'a text' : 'an email'}`,
          detail: m.subject ?? m.body.slice(0, 120),
        })
      }

      // Monthly advertiser reports are logged per campaign, so resolve theirs.
      const campaignIds = (campaigns as { id: string }[]).map((c) => c.id)
      if (campaignIds.length) {
        const reports = await safe(
          supabase
            .from('report_log')
            .select('period_month, sent_to, status, created_at')
            .in('campaign_id', campaignIds)
            .order('created_at', { ascending: false })
            .limit(MAX_EVENTS)
        )
        for (const r of reports as {
          period_month: string
          sent_to: string | null
          status: string
          created_at: string
        }[]) {
          out.push({
            at: r.created_at,
            kind: 'report',
            title: `${r.period_month} report ${r.status}`,
            detail: r.sent_to ?? undefined,
          })
        }
      }
    }

    if (subject.kind === 'venue' || subject.kind === 'screen') {
      // A venue's history is its screens' history, plus the host's report sends.
      let tvIds: string[] = [subject.id]
      let hostUserId: string | null = null
      if (subject.kind === 'venue') {
        const [{ data: tvRows }, { data: venueRow }] = await Promise.all([
          supabase.from('tvs').select('id').eq('venue_id', subject.id),
          supabase.from('venues').select('host_user_id, created_at, name').eq('id', subject.id).maybeSingle(),
        ])
        tvIds = ((tvRows ?? []) as { id: string }[]).map((t) => t.id)
        const v = venueRow as { host_user_id: string | null; created_at: string; name: string } | null
        hostUserId = v?.host_user_id ?? null
        if (v) out.push({ at: v.created_at, kind: 'note', title: 'Venue added to the network' })
      }

      if (tvIds.length) {
        const [alerts, placements, exclusions] = await Promise.all([
          safe(
            supabase
              .from('tv_alerts')
              .select('kind, sent_to, created_at')
              .in('tv_id', tvIds)
              .order('created_at', { ascending: false })
              .limit(MAX_EVENTS)
          ),
          safe(
            supabase
              .from('ad_placements')
              .select('status, created_at, ad:ads(title)')
              .in('tv_id', tvIds)
              .order('created_at', { ascending: false })
              .limit(MAX_EVENTS)
          ),
          safe(
            supabase
              .from('placement_exclusions')
              .select('created_at, campaign:campaigns(ad:ads(title))')
              .in('tv_id', tvIds)
              .order('created_at', { ascending: false })
              .limit(MAX_EVENTS)
          ),
        ])

        for (const a of alerts as { kind: string; sent_to: string | null; created_at: string }[]) {
          out.push({
            at: a.created_at,
            kind: 'alert',
            title: a.kind === 'offline' ? 'Screen went dark — host emailed' : `Alert: ${a.kind}`,
            detail: a.sent_to ?? undefined,
          })
        }
        const one = <T,>(v: T | T[] | null | undefined): T | null =>
          Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
        for (const p of placements as { status: string; created_at: string; ad: unknown }[]) {
          const title = one(p.ad as { title: string } | { title: string }[])?.title
          out.push({
            at: p.created_at,
            kind: 'placement',
            title: title ? `"${title}" placed here` : 'Ad placed here',
            detail: p.status === 'ended' ? 'since ended' : undefined,
          })
        }
        for (const e of exclusions as { created_at: string; campaign: unknown }[]) {
          const camp = one(e.campaign as { ad: unknown } | { ad: unknown }[])
          const title = one(camp?.ad as { title: string } | { title: string }[])?.title
          out.push({
            at: e.created_at,
            kind: 'placement',
            title: title ? `"${title}" pulled off this screen` : 'Ad pulled off this screen',
            detail: 'the engine will not put it back',
          })
        }
      }

      if (hostUserId) {
        const hostReports = await safe(
          supabase
            .from('host_report_log')
            .select('period_month, sent_to, status, created_at')
            .eq('host_user_id', hostUserId)
            .order('created_at', { ascending: false })
            .limit(MAX_EVENTS)
        )
        for (const r of hostReports as {
          period_month: string
          sent_to: string | null
          status: string
          created_at: string
        }[]) {
          out.push({
            at: r.created_at,
            kind: 'report',
            title: `${r.period_month} host recap ${r.status}`,
            detail: r.sent_to ?? undefined,
          })
        }
      }
    }

    return out
      .filter((e) => !!e.at)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, MAX_EVENTS)
  }
)

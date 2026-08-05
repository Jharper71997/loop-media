// Rules that chase people when nobody remembers to.
//
// Deliberately small: four triggers, three actions. A node-graph workflow builder
// is a product in its own right, and the actual failure mode in a two-person
// sales operation is not "my automation lacks a branch" — it is that a warm lead
// sat untouched for three weeks and nobody noticed.
//
// Runs once a day from inside an existing cron. Vercel Hobby caps this project at
// three cron jobs and all three are in use; a fourth silently breaks every future
// deploy, so this is folded into /api/cron/place rather than scheduled alongside.
//
// IDEMPOTENCE is the whole ballgame. `automation_runs` has a primary key of
// (automation_id, opportunity_id), so a rule fires at most once per card, ever.
// Without that, "chase anything stale" would re-fire every morning and bury the
// Today queue in duplicates within a week.
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { renderTemplate, outreachHtml } from '@/lib/messaging'
import { stageLabel, type OpportunityKind } from '@/lib/pipeline'

export type AutomationTrigger = 'stage_stale' | 'no_next_step' | 'won' | 'lost'
export type AutomationAction = 'set_next_step' | 'log_note' | 'send_email'

export interface Automation {
  id: string
  territoryId: string | null
  name: string
  enabled: boolean
  kind: OpportunityKind | null
  trigger: AutomationTrigger
  stage: string | null
  days: number | null
  action: AutomationAction
  actionText: string | null
  templateId: string | null
  lastRunAt: string | null
}

export const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  stage_stale: 'Sits in a stage untouched',
  no_next_step: 'Open with no follow-up set',
  won: 'When a deal is won',
  lost: 'When a deal is lost',
}

export const ACTION_LABEL: Record<AutomationAction, string> = {
  set_next_step: 'Put a follow-up on Today',
  log_note: 'Write a note on the timeline',
  send_email: 'Send an email',
}

// A sentence describing what the rule does, built from its own fields — so the
// list reads as English instead of as a row of enum values.
export function describe(a: Automation): string {
  const who =
    a.kind === 'host' ? 'a host' : a.kind === 'advertiser' ? 'an advertiser' : 'any prospect'
  const when =
    a.trigger === 'stage_stale'
      ? `${who} sits in ${a.stage ? stageLabel(a.kind ?? 'advertiser', a.stage) : 'any stage'} for ${a.days ?? 0} days with no contact`
      : a.trigger === 'no_next_step'
        ? `${who} has been open ${a.days ?? 0} days with no follow-up set`
        : a.trigger === 'won'
          ? `${who} is marked won`
          : `${who} is marked lost`

  const then =
    a.action === 'set_next_step'
      ? `add a follow-up for today saying "${a.actionText ?? 'Follow up'}"`
      : a.action === 'log_note'
        ? `note "${a.actionText ?? ''}" on the timeline`
        : 'send them the chosen email template'

  return `When ${when}, ${then}.`
}

export interface RunSummary {
  evaluated: number
  fired: number
  errors: string[]
}

type Row = {
  id: string
  kind: string
  stage: string
  status: string
  business_name: string
  contact_name: string | null
  city: string | null
  email: string | null
  territory_id: string
  advertiser_id: string | null
  next_step_at: string | null
  last_touch_at: string | null
  created_at: string
  won_at: string | null
  lost_at: string | null
}

const DAY = 86_400_000

// `admin` must be a service-role client: this runs from cron with no session.
export async function runAutomations(
  admin: SupabaseClient,
  opts: { dry?: boolean } = {}
): Promise<RunSummary> {
  const summary: RunSummary = { evaluated: 0, fired: 0, errors: [] }

  const { data: autoData, error: autoError } = await admin
    .from('automations')
    .select('*')
    .eq('enabled', true)
  if (autoError) {
    // The table not existing is the expected state until 0069 is applied.
    if (autoError.code !== '42P01' && autoError.code !== 'PGRST205') {
      summary.errors.push(`load automations: ${autoError.message}`)
    }
    return summary
  }

  const automations = (autoData ?? []) as unknown as Array<{
    id: string
    territory_id: string | null
    name: string
    kind: string | null
    trigger: AutomationTrigger
    stage: string | null
    days: number | null
    action: AutomationAction
    action_text: string | null
    template_id: string | null
  }>
  if (!automations.length) return summary

  const now = Date.now()
  const nowISO = new Date(now).toISOString()

  for (const a of automations) {
    let q = admin
      .from('opportunities')
      .select(
        'id, kind, stage, status, business_name, contact_name, city, email, territory_id, advertiser_id, next_step_at, last_touch_at, created_at, won_at, lost_at'
      )
    if (a.territory_id) q = q.eq('territory_id', a.territory_id)
    if (a.kind) q = q.eq('kind', a.kind)
    q = a.trigger === 'won' || a.trigger === 'lost'
      ? q.eq('status', a.trigger)
      : q.eq('status', 'open')
    if (a.trigger === 'stage_stale' && a.stage) q = q.eq('stage', a.stage)

    const { data, error } = await q
    if (error) {
      summary.errors.push(`${a.name}: ${error.message}`)
      continue
    }

    const rows = (data ?? []) as Row[]
    summary.evaluated += rows.length

    // Which of these this rule has already handled.
    const { data: ranData } = await admin
      .from('automation_runs')
      .select('opportunity_id')
      .eq('automation_id', a.id)
    const already = new Set(((ranData ?? []) as { opportunity_id: string }[]).map((r) => r.opportunity_id))

    const days = a.days ?? 0
    const due = rows.filter((r) => {
      if (already.has(r.id)) return false
      if (a.trigger === 'stage_stale') {
        // No touch recorded at all falls back to when it was added, so an
        // imported card that has never been worked still counts as stale.
        const since = new Date(r.last_touch_at ?? r.created_at).getTime()
        return now - since >= days * DAY
      }
      if (a.trigger === 'no_next_step') {
        if (r.next_step_at) return false
        const since = new Date(r.last_touch_at ?? r.created_at).getTime()
        return now - since >= days * DAY
      }
      return true // won / lost — status already filtered above
    })

    for (const r of due) {
      if (opts.dry) {
        summary.fired++
        continue
      }
      try {
        await applyAction(admin, a, r, nowISO)
        await admin
          .from('automation_runs')
          .insert({ automation_id: a.id, opportunity_id: r.id })
        summary.fired++
      } catch (e) {
        summary.errors.push(`${a.name} / ${r.business_name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    if (!opts.dry) {
      await admin.from('automations').update({ last_run_at: nowISO }).eq('id', a.id)
    }
  }

  return summary
}

async function applyAction(
  admin: SupabaseClient,
  a: {
    id: string
    name: string
    action: AutomationAction
    action_text: string | null
    template_id: string | null
  },
  r: Row,
  nowISO: string
): Promise<void> {
  if (a.action === 'set_next_step') {
    const step = a.action_text?.trim() || `Follow up with ${r.business_name}`
    await admin
      .from('opportunities')
      .update({ next_step: step, next_step_at: nowISO })
      .eq('id', r.id)
    await admin.from('opportunity_events').insert({
      opportunity_id: r.id,
      kind: 'note',
      body: `Automation "${a.name}" set a follow-up: ${step}`,
    })
    return
  }

  if (a.action === 'log_note') {
    await admin.from('opportunity_events').insert({
      opportunity_id: r.id,
      kind: 'note',
      body: a.action_text?.trim() || `Automation "${a.name}" fired.`,
    })
    return
  }

  // send_email
  if (!a.template_id) throw new Error('no template chosen')
  if (!r.email) throw new Error('no email address on the record')

  const { data: tplData } = await admin
    .from('message_templates')
    .select('subject, body')
    .eq('id', a.template_id)
    .maybeSingle()
  const tpl = tplData as { subject: string | null; body: string } | null
  if (!tpl) throw new Error('template no longer exists')

  const ctx = {
    business: r.business_name,
    contact: r.contact_name,
    city: r.city,
    // Automated mail is not from a person in the room, so it signs as the
    // business rather than impersonating whoever set the rule up.
    myName: 'Loop Network',
  }
  const subject = renderTemplate(tpl.subject ?? '', ctx)
  const body = renderTemplate(tpl.body, ctx)

  const res = await sendEmail({ to: r.email, subject, html: outreachHtml(body) })
  const ok = res.ok
  const err = ok
    ? null
    : 'skipped' in res && res.skipped
      ? 'email not configured (RESEND_API_KEY unset)'
      : (res as { error: string }).error

  await admin.from('messages').insert({
    opportunity_id: r.id,
    advertiser_id: r.advertiser_id,
    territory_id: r.territory_id,
    channel: 'email',
    direction: 'out',
    to_address: r.email,
    subject,
    body,
    status: ok ? 'sent' : 'failed',
    provider: 'resend',
    provider_id: ok ? res.id : null,
    error: err,
  })

  await admin.from('opportunity_events').insert({
    opportunity_id: r.id,
    kind: 'email',
    body: ok ? `Automation "${a.name}" sent: ${subject}` : `Automation "${a.name}" failed: ${err}`,
  })

  if (ok) {
    await admin.from('opportunities').update({ last_touch_at: nowISO }).eq('id', r.id)
  } else {
    throw new Error(err ?? 'send failed')
  }
}

'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, adminCanTerritory } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { isMissingTable } from '@/lib/opportunities'
import {
  BULK_MAX,
  checkCompose,
  outreachHtml,
  renderTemplate,
  smsEnabled,
  SMS_DISABLED_REASON,
  type Channel,
} from '@/lib/messaging'

// Sending, and the record of having sent.
//
// Every send writes a messages row whether it succeeded or not. A failed send
// that vanishes is worse than a visible failure: you would retype the whole
// thing not knowing the first one never left.

const MIGRATION_HINT =
  'The messaging tables do not exist yet. Run loop-run-this-next.sql (on your Desktop) in the Supabase SQL editor, then try again.'

type Result = { error: string | null }

export interface SendInput {
  opportunityId?: string | null
  advertiserId?: string | null
  channel: Channel
  to: string
  subject?: string | null
  body: string
  templateId?: string | null
}

// Annotated as a discriminated union rather than inferred: TypeScript otherwise
// widens the two branches into one object with every field optional.
type Target =
  | { ok: false; error: string }
  | {
      ok: true
      profile: Awaited<ReturnType<typeof requireAdmin>>
      admin: ReturnType<typeof createAdminClient>
      territoryId: string
      context: { business: string; contact: string; city: string }
    }

// Resolve the record being messaged and prove the caller may touch its market.
// Service-role writes bypass RLS, so territory scope is re-checked here.
async function resolveTarget(input: SendInput): Promise<Target> {
  const profile = await requireAdmin()
  const admin = createAdminClient()

  let territoryId: string | null = null
  let context = { business: '', contact: '', city: '' }

  if (input.opportunityId) {
    const { data, error } = await admin
      .from('opportunities')
      .select('territory_id, business_name, contact_name, city, advertiser_id')
      .eq('id', input.opportunityId)
      .maybeSingle()
    if (error)
      return { ok: false, error: isMissingTable(error) ? MIGRATION_HINT : error.message }
    if (!data) return { ok: false, error: 'That record no longer exists.' }
    const o = data as {
      territory_id: string
      business_name: string
      contact_name: string | null
      city: string | null
      advertiser_id: string | null
    }
    territoryId = o.territory_id
    context = {
      business: o.business_name,
      contact: o.contact_name ?? '',
      city: o.city ?? '',
    }
  } else if (input.advertiserId) {
    const { data } = await admin
      .from('profiles')
      .select('territory_id, full_name, email')
      .eq('id', input.advertiserId)
      .maybeSingle()
    const p = data as { territory_id: string | null; full_name: string | null; email: string } | null
    if (!p) return { ok: false, error: 'That account no longer exists.' }
    // An advertiser with no home market falls back to the admin's own, since a
    // message row requires one.
    territoryId = p.territory_id ?? profile.territory_id
    context = { business: p.full_name ?? p.email, contact: p.full_name ?? '', city: '' }
  }

  if (!territoryId)
    return { ok: false, error: 'Could not work out which market this belongs to.' }
  if (!adminCanTerritory(profile, territoryId)) {
    return { ok: false, error: 'That record is outside your access.' }
  }
  return { ok: true, profile, admin, territoryId, context }
}

export async function sendMessage(input: SendInput): Promise<Result> {
  const t = await resolveTarget(input)
  if (!t.ok) return { error: t.error }
  const { profile, admin, territoryId, context } = t

  const ctx = { ...context, myName: profile.full_name ?? undefined }
  const subject = input.subject ? renderTemplate(input.subject, ctx) : null
  const body = renderTemplate(input.body, ctx)

  const check = checkCompose({ channel: input.channel, to: input.to, subject, body })
  if (!check.ok) return { error: check.error }

  if (input.channel === 'sms' && !smsEnabled()) {
    return { error: SMS_DISABLED_REASON }
  }

  // Send first, then record the outcome — so status is the truth rather than an
  // optimistic guess.
  let status: 'sent' | 'failed' = 'sent'
  let providerId: string | null = null
  let error: string | null = null

  if (input.channel === 'email') {
    const res = await sendEmail({
      to: input.to,
      subject: subject ?? '',
      html: outreachHtml(body),
      // Replies go to the human who sent it, not to the no-reply reports box.
      replyTo: profile.email,
    })
    if (res.ok) {
      providerId = res.id
    } else if ('skipped' in res && res.skipped) {
      status = 'failed'
      error = 'Email is not configured on this deployment (RESEND_API_KEY is unset).'
    } else {
      status = 'failed'
      error = res.error
    }
  }

  const { error: insertError } = await admin.from('messages').insert({
    opportunity_id: input.opportunityId ?? null,
    advertiser_id: input.advertiserId ?? null,
    territory_id: territoryId,
    channel: input.channel,
    direction: 'out',
    to_address: input.to,
    from_address: profile.email,
    subject,
    body,
    status,
    provider: input.channel === 'email' ? 'resend' : 'twilio',
    provider_id: providerId,
    error,
    created_by: profile.id,
  })
  if (insertError) {
    return { error: isMissingTable(insertError) ? MIGRATION_HINT : insertError.message }
  }

  // Messaging someone counts as touching them, so the card stops looking cold
  // and the timeline says what happened.
  if (input.opportunityId) {
    await admin
      .from('opportunities')
      .update({ last_touch_at: new Date().toISOString() })
      .eq('id', input.opportunityId)
    await admin.from('opportunity_events').insert({
      opportunity_id: input.opportunityId,
      kind: input.channel === 'sms' ? 'call' : 'email',
      body: status === 'sent' ? (subject ?? body.slice(0, 120)) : `Send failed: ${error}`,
      created_by: profile.id,
    })
    revalidatePath(`/admin/pipeline/${input.opportunityId}`)
    revalidatePath('/admin/pipeline')
  }
  if (input.advertiserId) revalidatePath(`/admin/advertisers/${input.advertiserId}`)
  revalidatePath('/admin')

  return { error: status === 'sent' ? null : error }
}

// ---------------------------------------------------------------------------
// Bulk outreach
// ---------------------------------------------------------------------------

export interface BulkResult {
  sent: number
  failed: number
  skipped: number
  error: string | null
}

// Takes EXPLICIT ids rather than a filter. The page shows you a list and then
// sends to exactly that list — re-running the filter server-side could quietly
// send to a different set than the one you looked at.
export async function sendBulkOutreach(input: {
  opportunityIds: string[]
  subject: string
  body: string
  templateId?: string | null
}): Promise<BulkResult> {
  const profile = await requireAdmin()
  const admin = createAdminClient()

  const ids = [...new Set(input.opportunityIds.filter(Boolean))]
  if (!ids.length) return { sent: 0, failed: 0, skipped: 0, error: 'Nobody selected.' }
  if (ids.length > BULK_MAX) {
    return { sent: 0, failed: 0, skipped: 0, error: `That is more than ${BULK_MAX} at once.` }
  }
  if (!input.subject.trim() || !input.body.trim()) {
    return { sent: 0, failed: 0, skipped: 0, error: 'Needs a subject and a body.' }
  }

  const { data, error } = await admin
    .from('opportunities')
    .select('id, territory_id, business_name, contact_name, city, email, advertiser_id')
    .in('id', ids)
  if (error) {
    return {
      sent: 0,
      failed: 0,
      skipped: 0,
      error: isMissingTable(error) ? MIGRATION_HINT : error.message,
    }
  }

  type Row = {
    id: string
    territory_id: string
    business_name: string
    contact_name: string | null
    city: string | null
    email: string | null
    advertiser_id: string | null
  }
  const rows = (data ?? []) as Row[]

  let sent = 0
  let failed = 0
  let skipped = 0
  const now = new Date().toISOString()

  for (const r of rows) {
    if (!adminCanTerritory(profile, r.territory_id) || !r.email?.trim()) {
      skipped++
      continue
    }

    const ctx = {
      business: r.business_name,
      contact: r.contact_name,
      city: r.city,
      myName: profile.full_name,
    }
    const subject = renderTemplate(input.subject, ctx)
    const body = renderTemplate(input.body, ctx)

    const res = await sendEmail({
      to: r.email,
      subject,
      html: outreachHtml(body),
      replyTo: profile.email,
    })
    const ok = res.ok
    const errText = ok
      ? null
      : 'skipped' in res && res.skipped
        ? 'Email is not configured on this deployment (RESEND_API_KEY is unset).'
        : (res as { error: string }).error

    if (ok) sent++
    else failed++

    await admin.from('messages').insert({
      opportunity_id: r.id,
      advertiser_id: r.advertiser_id,
      territory_id: r.territory_id,
      channel: 'email',
      direction: 'out',
      to_address: r.email,
      from_address: profile.email,
      subject,
      body,
      status: ok ? 'sent' : 'failed',
      provider: 'resend',
      provider_id: ok ? res.id : null,
      error: errText,
      template_key: input.templateId ?? null,
      created_by: profile.id,
    })

    if (ok) {
      await admin.from('opportunities').update({ last_touch_at: now }).eq('id', r.id)
      await admin.from('opportunity_events').insert({
        opportunity_id: r.id,
        kind: 'email',
        body: `Outreach: ${subject}`,
        created_by: profile.id,
      })
    }
  }

  revalidatePath('/admin/pipeline')
  revalidatePath('/admin')
  return {
    sent,
    failed,
    skipped,
    error: failed > 0 ? `${failed} did not send. Open each record to see why.` : null,
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface TemplateInput {
  id?: string | null
  name: string
  channel: Channel
  audience: 'advertiser' | 'host' | 'any'
  subject?: string | null
  body: string
  active?: boolean
}

export async function saveTemplate(input: TemplateInput): Promise<Result> {
  const profile = await requireAdmin()
  const name = input.name?.trim()
  const body = input.body?.trim()
  if (!name) return { error: 'Give the template a name.' }
  if (!body) return { error: 'The template has no body.' }
  if (input.channel === 'email' && !input.subject?.trim()) {
    return { error: 'An email template needs a subject.' }
  }

  const admin = createAdminClient()
  const row = {
    name,
    channel: input.channel,
    audience: input.audience,
    subject: input.subject?.trim() || null,
    body,
    active: input.active ?? true,
  }

  const { error } = input.id
    ? await admin.from('message_templates').update(row).eq('id', input.id)
    : await admin.from('message_templates').insert({ ...row, created_by: profile.id })

  if (error) return { error: isMissingTable(error) ? MIGRATION_HINT : error.message }

  revalidatePath('/admin/messages')
  revalidatePath('/admin/pipeline')
  return { error: null }
}

export async function deleteTemplate(id: string): Promise<Result> {
  await requireAdmin()
  const admin = createAdminClient()
  const { error } = await admin.from('message_templates').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/messages')
  return { error: null }
}

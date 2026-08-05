// Outreach messaging: templates, variable substitution, and the rules about what
// may be sent.
//
// Pure and client-safe — the compose box previews a rendered template as you
// type, so this cannot import next/headers or the mail transport.

export type Channel = 'email' | 'sms'
export type Direction = 'out' | 'in'
export type MessageStatus = 'queued' | 'sent' | 'failed' | 'received'

export interface MessageTemplate {
  id: string
  name: string
  channel: Channel
  audience: 'advertiser' | 'host' | 'any'
  subject: string | null
  body: string
  active: boolean
}

export interface Message {
  id: string
  channel: Channel
  direction: Direction
  toAddress: string | null
  fromAddress: string | null
  subject: string | null
  body: string
  status: MessageStatus
  error: string | null
  createdAt: string
  authorName: string | null
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

export const TEMPLATE_VARS = [
  { key: 'business', label: 'Business name' },
  { key: 'contact', label: 'Contact name (falls back to "there")' },
  { key: 'first_name', label: 'Contact first name' },
  { key: 'city', label: 'City' },
  { key: 'my_name', label: 'Your name' },
] as const

export interface TemplateContext {
  business?: string | null
  contact?: string | null
  city?: string | null
  myName?: string | null
}

// "Hi {contact}," with no contact name has to read as a sentence, not as a hole.
// A greeting that says "Hi ," is worse than no personalisation at all.
export function renderTemplate(text: string, ctx: TemplateContext): string {
  const contact = ctx.contact?.trim() || 'there'
  const values: Record<string, string> = {
    business: ctx.business?.trim() || 'your business',
    contact,
    first_name: contact.split(/\s+/)[0] || 'there',
    city: ctx.city?.trim() || 'your area',
    my_name: ctx.myName?.trim() || 'Jacob',
  }
  return text.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? values[key] : whole
  )
}

// Which variables a template actually uses, so the editor can show what will be
// filled in without the writer guessing.
export function usedVars(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))]
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Deliberately loose: this rejects obvious typos, not unusual-but-valid
// addresses. Bouncing a real prospect because their domain looks odd is a worse
// outcome than one failed send.
export function isEmailish(value: string | null | undefined): boolean {
  if (!value) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())
}

export const SMS_MAX = 320

// The ceiling on one bulk send. Not a technical limit, a judgement one: this is
// one-to-one sales outreach from a personal address, not a marketing blast, and
// a few hundred identical emails in a burst is how a sending domain earns a
// reputation problem. Loop's whole deliverability rides on loopnetwork.org.
//
// It lives here rather than beside the action because a 'use server' module may
// only export async functions — exporting a plain const from one silently breaks
// every other export in it.
export const BULK_MAX = 100

export type ComposeCheck = { ok: true } | { ok: false; error: string }

export function checkCompose(input: {
  channel: Channel
  to: string | null
  subject: string | null
  body: string
}): ComposeCheck {
  const body = input.body.trim()
  if (!body) return { ok: false, error: 'Nothing to send.' }

  if (input.channel === 'email') {
    if (!isEmailish(input.to)) return { ok: false, error: 'No email address on this record.' }
    if (!input.subject?.trim()) return { ok: false, error: 'Give it a subject.' }
  } else {
    if (!input.to?.trim()) return { ok: false, error: 'No phone number on this record.' }
    if (body.length > SMS_MAX) {
      return { ok: false, error: `Too long for a text: ${body.length} of ${SMS_MAX} characters.` }
    }
  }
  return { ok: true }
}

// Jacob's outreach rule: no em or en dashes in anything a customer reads. Not
// enforced (it is his copy), but flagged in the composer so it is caught before
// send rather than after.
export function dashWarning(body: string, subject?: string | null): string | null {
  const text = `${subject ?? ''} ${body}`
  if (!/[—–]/.test(text)) return null
  return 'Contains an em or en dash. Your rule is to keep those out of outreach.'
}

// ---------------------------------------------------------------------------
// Channel availability
// ---------------------------------------------------------------------------

// SMS is modelled end to end but has no provider yet: this app has no Twilio
// account. The schema, the composer and the thread all already handle 'sms', so
// switching it on is setting these env vars, not a migration or a rebuild.
export function smsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER)
}

export const SMS_DISABLED_REASON =
  'Texting is not switched on yet. It needs a Twilio number and TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER in the environment.'

// ---------------------------------------------------------------------------
// Rendering an outreach email
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Outreach mail is deliberately NOT the branded transactional shell used for
// receipts and reports. A one to one sales email that arrives looking like a
// marketing blast gets read like one; this renders as plain paragraphs, which is
// what a message typed by a person looks like.
export function outreachHtml(body: string): string {
  const paragraphs = body
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
  return `<div style="font:15px/1.6 -apple-system,Segoe UI,system-ui,sans-serif;color:#1a1a1a;max-width:560px">${paragraphs}</div>`
}

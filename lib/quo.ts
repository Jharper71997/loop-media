// Quo (formerly OpenPhone) — turning a webhook into a row on a timeline.
//
// Calls and texts happen on a real business number, in Quo's own phone app, on
// whatever device is to hand. Quo posts here when something finishes. That is
// the whole reason this integration is shaped as a LISTENER rather than a dialer
// built into the admin: a call made from a phone in a car has to land on the
// same timeline as an email sent from a desk, and nothing that depends on
// remembering to press a button in a web app will ever manage that.
//
// This module is pure — verification and normalisation, no database. The route
// that uses it is app/api/webhooks/quo/route.ts.
//
// Field names below come from Quo's published OpenAPI specs (the calls and
// messages APIs), not from guesswork. Anything the specs do not pin down is read
// defensively and the raw payload is stored regardless, so a schema surprise is
// recoverable from data we already have rather than lost.
import { createHmac, timingSafeEqual } from 'crypto'

export const QUO_PROVIDER = 'quo'

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------
// Quo has TWO signing schemes and they are not interchangeable:
//
//   * Standard Webhooks (the current one): `webhook-id`, `webhook-timestamp`,
//     `webhook-signature` headers with a `whsec_`-prefixed base64 secret.
//     Signature is base64(HMAC-SHA256(secret, "<id>.<timestamp>.<body>")) and
//     the header carries a space-separated list of `v1,<sig>` — a list because
//     it lets them rotate secrets without an outage.
//   * Legacy: a single `openphone-signature` header shaped
//     `hmac;1;<timestamp>;<base64sig>`.
//
// Both are supported so it does not matter which one his webhook was created
// under. If neither header is present we reject — an unauthenticated writer to
// the message log is not something to be relaxed about.

export type VerifyResult =
  | { ok: true; scheme: 'standard' | 'legacy' }
  | { ok: false; reason: string }

/** Constant-time compare that cannot throw on a length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/** Reject anything older than this, so a captured delivery cannot be replayed. */
const MAX_SKEW_MS = 5 * 60 * 1000

export function verifyQuoSignature(
  headers: Headers,
  rawBody: string,
  secret: string,
  now = Date.now()
): VerifyResult {
  if (!secret) return { ok: false, reason: 'QUO_WEBHOOK_SECRET is not set' }

  // ---- Standard Webhooks ----
  const id = headers.get('webhook-id')
  const ts = headers.get('webhook-timestamp')
  const sig = headers.get('webhook-signature')
  if (id && ts && sig) {
    const seconds = Number(ts)
    if (!Number.isFinite(seconds)) return { ok: false, reason: 'bad webhook-timestamp' }
    if (Math.abs(now - seconds * 1000) > MAX_SKEW_MS)
      return { ok: false, reason: 'timestamp outside tolerance' }

    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
    const expected = createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest('base64')
    // Space-separated `v1,<sig>` entries; any one matching is a pass.
    const offered = sig.split(' ').map((p) => p.split(',').slice(1).join(','))
    if (offered.some((o) => safeEqual(o, expected))) return { ok: true, scheme: 'standard' }
    return { ok: false, reason: 'signature mismatch (standard)' }
  }

  // ---- Legacy ----
  const legacy = headers.get('openphone-signature')
  if (legacy) {
    const [, , legacyTs, legacySig] = legacy.split(';')
    if (!legacyTs || !legacySig) return { ok: false, reason: 'malformed openphone-signature' }
    const ms = Number(legacyTs)
    if (!Number.isFinite(ms)) return { ok: false, reason: 'bad legacy timestamp' }
    if (Math.abs(now - ms) > MAX_SKEW_MS) return { ok: false, reason: 'timestamp outside tolerance' }

    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
    const expected = createHmac('sha256', key).update(`${legacyTs}.${rawBody}`).digest('base64')
    if (safeEqual(legacySig, expected)) return { ok: true, scheme: 'legacy' }
    return { ok: false, reason: 'signature mismatch (legacy)' }
  }

  return { ok: false, reason: 'no signature header' }
}

// ---------------------------------------------------------------------------
// Payload normalisation
// ---------------------------------------------------------------------------

/** The last ten digits — how every number in this app is compared. See 0074. */
export function phoneKey(value: string | null | undefined): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : null
}

/** A phone number as typed back to a human: (910) 555-0134. */
export function formatPhone(value: string | null | undefined): string {
  const k = phoneKey(value)
  if (!k) return value ?? ''
  return `(${k.slice(0, 3)}) ${k.slice(3, 6)}-${k.slice(6)}`
}

export interface NormalizedEvent {
  /** Quo's id for the call or message — the idempotency key. */
  providerId: string
  channel: 'call' | 'sms'
  /** Relative to us, not to Quo: 'out' is us reaching them. */
  direction: 'out' | 'in'
  /** The other party, last ten digits. Null if it could not be read. */
  contactKey: string | null
  /** The other party as Quo gave it, for display. */
  contactPhone: string | null
  /** Our Quo number. */
  ourPhone: string | null
  body: string
  durationSeconds: number | null
  answered: boolean | null
  status: 'sent' | 'received' | 'failed'
  occurredAt: string
}

type Json = Record<string, unknown>

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** `to` is a string on some events and an array on others. Take the first. */
function firstOf(v: unknown): string | null {
  if (Array.isArray(v)) return str(v[0])
  return str(v)
}

/**
 * A Quo webhook body into one row, or null if it is an event we do not record.
 *
 * We deliberately keep only completed calls and settled messages. `call.ringing`
 * and friends describe a call in flight; recording them would put three rows on
 * the timeline for one conversation, which is the noise problem this whole admin
 * has been fighting.
 */
export function normalizeQuoEvent(payload: Json): NormalizedEvent | null {
  const type = str(payload.type) ?? str((payload.data as Json | undefined)?.type)
  if (!type) return null

  const data = (payload.data ?? {}) as Json
  const resource = (data.resource ?? data) as Json

  const providerId = str(resource.id)
  if (!providerId) return null

  const occurredAt =
    str(resource.completedAt) ??
    str(resource.createdAt) ??
    str(payload.createdAt) ??
    new Date().toISOString()

  // ---- Calls ----
  if (type.startsWith('call.')) {
    // Only the finished article. A missed call arrives as call.completed with a
    // status of missed/no-answer, so nothing is lost by ignoring the rest.
    if (type !== 'call.completed' && type !== 'call.missed') return null

    const direction = resource.direction === 'incoming' ? 'in' : 'out'
    const status = str(resource.status) ?? ''
    // `participants` is [ours, theirs] in E.164, max 2 — but which slot is ours
    // depends on direction, so pick by elimination against our own number.
    const participants = Array.isArray(resource.participants)
      ? (resource.participants as unknown[]).map((p) => str(p)).filter((p): p is string => !!p)
      : []
    const ourPhone = firstOf((data.context as Json | undefined)?.phoneNumber) ?? null
    const ourKey = phoneKey(ourPhone)
    const theirs = participants.find((p) => phoneKey(p) !== ourKey) ?? participants[0] ?? null

    const answered = !!str(resource.answeredAt) || status === 'answered' || status === 'completed'
    const duration = num(resource.duration)

    return {
      providerId,
      channel: 'call',
      direction,
      contactKey: phoneKey(theirs),
      contactPhone: theirs,
      ourPhone,
      // The body IS the summary — this is what reads on the timeline.
      body: callSummary(direction, answered, duration, status),
      durationSeconds: duration,
      answered,
      status: direction === 'in' ? 'received' : 'sent',
      occurredAt,
    }
  }

  // ---- Texts ----
  if (type === 'message.received' || type === 'message.delivered') {
    const direction = resource.direction === 'incoming' ? 'in' : 'out'
    const from = str(resource.from)
    const to = firstOf(resource.to)
    const theirs = direction === 'in' ? from : to
    const ours = direction === 'in' ? to : from
    const text = str(resource.text) ?? ''
    const status = str(resource.status) ?? ''

    return {
      providerId,
      channel: 'sms',
      direction,
      contactKey: phoneKey(theirs),
      contactPhone: theirs,
      ourPhone: ours,
      body: text,
      durationSeconds: null,
      answered: null,
      status:
        direction === 'in' ? 'received' : status === 'delivered' || status === 'sent' ? 'sent' : 'failed',
      occurredAt,
    }
  }

  return null
}

/** "Called them · 4m 12s" / "Missed call from them" — a line, not a data dump. */
export function callSummary(
  direction: 'in' | 'out',
  answered: boolean,
  durationSeconds: number | null,
  status: string
): string {
  if (!answered) {
    if (direction === 'in') return status === 'missed' ? 'Missed call' : 'Incoming call, not answered'
    return 'Called them, no answer'
  }
  const d = durationSeconds ?? 0
  const mins = Math.floor(d / 60)
  const secs = d % 60
  const length = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  return direction === 'in' ? `They called · ${length}` : `Called them · ${length}`
}

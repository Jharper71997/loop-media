// Transactional email via Resend's REST API — no SDK dependency (same fetch-only
// pattern the rest of the app uses for external calls). Server-only.
//
// Set RESEND_API_KEY to turn sending on. When it's unset (local dev, CI, a build
// machine without secrets) send() is a no-op that logs and reports skipped:true,
// so nothing throws and no mail goes out by accident. RESEND_FROM overrides the
// From address; it must be on a domain verified in the Resend dashboard.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const DEFAULT_FROM = 'Loop Network <reports@loopnetwork.app>'

export type SendEmailInput = {
  to: string | string[]
  subject: string
  html: string
  replyTo?: string
}

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped?: false; error: string }

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    console.warn(`[email] RESEND_API_KEY unset — skipping "${input.subject}"`)
    return { ok: false, skipped: true, reason: 'RESEND_API_KEY not set' }
  }

  const from = process.env.RESEND_FROM || DEFAULT_FROM
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        html: input.html,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` }
    }
    const json = (await res.json()) as { id?: string }
    return { ok: true, id: json.id ?? '' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

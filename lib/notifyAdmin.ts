// Admin alert: a heads-up to the network operators the moment an advertiser
// submits a new ad that needs review, so nothing sits in the approval queue
// unseen. Server-only, best-effort (the caller wraps it in try/catch). Uses the
// service-role client so it can read every admin's profile regardless of RLS.
//
// Recipients: ADMIN_ALERT_EMAIL (comma-separated) when set, otherwise every
// global admin — role='admin' with no territory (the Holdings operators).

import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { escapeHtml } from '@/lib/emailSettings'
import { appUrl } from '@/lib/stripe'

type AdminClient = ReturnType<typeof createAdminClient>

// A PostgREST embed comes back as an object or a single-element array depending on
// the relationship; pull the name out of either shape.
function embeddedName(v: unknown): string | null {
  const rel = Array.isArray(v) ? v[0] : v
  const name = (rel as { name?: unknown } | null | undefined)?.name
  return typeof name === 'string' ? name : null
}

export async function adminRecipients(admin: AdminClient): Promise<string[]> {
  const pinned = process.env.ADMIN_ALERT_EMAIL
  if (pinned) {
    return pinned
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  const { data } = await admin.from('profiles').select('email, territory_id').eq('role', 'admin')
  return (data ?? [])
    .filter((p) => !p.territory_id && p.email)
    .map((p) => p.email as string)
}

// One inline-styled dark card matching the advertiser notices (lib/notifyAdvertiser).
export async function notifyAdminNewAd(adId: string): Promise<void> {
  const admin = createAdminClient()

  const { data: ad } = await admin
    .from('ads')
    .select(
      'title, creative_url, owner_user_id, category:categories(name), territory:territories(name)'
    )
    .eq('id', adId)
    .maybeSingle()
  if (!ad) return

  const to = await adminRecipients(admin)
  if (!to.length) return

  // Who submitted it, for context in the alert.
  let advertiser = 'An advertiser'
  if (ad.owner_user_id) {
    const { data: owner } = await admin
      .from('profiles')
      .select('full_name, email')
      .eq('id', ad.owner_user_id as string)
      .maybeSingle()
    advertiser = (owner?.full_name as string) || (owner?.email as string) || advertiser
  }

  const title = (ad.title as string) || 'Untitled ad'
  const category = embeddedName(ad.category)
  const territory = embeddedName(ad.territory)
  // The "make it for me" path submits no file yet — flag it so review knows.
  const needsCreative = !ad.creative_url
  const base = appUrl().replace(/\/$/, '')
  const queueUrl = `${base}/admin/queue`

  const rows: [string, string][] = [
    ['Ad', title],
    ['Advertiser', advertiser],
    ...((category ? [['Category', category]] : []) as [string, string][]),
    ...((territory ? [['Market', territory]] : []) as [string, string][]),
    ['Creative', needsCreative ? 'Requested (we make it for them)' : 'Uploaded'],
  ]
  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 14px 4px 0;color:#a1a1aa;font-size:13px;white-space:nowrap;vertical-align:top;">${escapeHtml(
          k
        )}</td><td style="padding:4px 0;color:#fafafa;font-size:13px;font-weight:600;">${escapeHtml(
          v
        )}</td></tr>`
    )
    .join('')

  const html = `<!doctype html><html><body style="margin:0;background:#09090b;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#0a0a0b;border:1px solid #27272a;border-radius:14px;overflow:hidden;">
      <tr><td style="padding:24px 28px;border-bottom:1px solid #27272a;">
        <div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#d4a333;font-weight:700;">Loop Network</div>
        <div style="margin-top:2px;color:#a1a1aa;font-size:13px;">Ad pending review</div>
      </td></tr>
      <tr><td style="padding:24px 28px;">
        <div style="margin:0 0 16px;color:#fafafa;font-size:20px;font-weight:700;">New ad waiting for approval</div>
        <table role="presentation" cellpadding="0" cellspacing="0">${rowsHtml}</table>
        <div style="margin-top:22px;"><a href="${queueUrl}" style="display:inline-block;background:#d4a333;color:#0a0a0b;font-weight:700;font-size:14px;text-decoration:none;padding:11px 20px;border-radius:9px;">Review in the queue</a></div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`

  await sendEmail({ to, subject: `New ad pending review: ${title}`, html })
}

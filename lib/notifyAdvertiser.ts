// Transactional advertiser notifications: short, branded, service-only emails for
// the moments that matter (ad reviewed, payment received). Service/metrics only —
// never a sell or a goal push (Jacob's rule). Best-effort: every send is wrapped
// so a mail failure never blocks the action that triggered it. Server-only.
//
// Copy + on/off live in email_settings (see lib/emailSettings + /admin/email).
// Each send resolves its row first: if the email is disabled it silently no-ops;
// otherwise the admin's subject/heading/body (or the code default) is used, with
// the greeting, branded shell, CTA button, and footer still owned here.

import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { resolveEmail, escapeHtml } from '@/lib/emailSettings'
import { appUrl } from '@/lib/stripe'
import { formatCents } from '@/lib/format'

type Admin = ReturnType<typeof createAdminClient>

const greet = (name: string | null) => (name ? `Hi ${escapeHtml(name.split(' ')[0])},` : 'Hi,')

// One shared dark, inline-styled shell so every notice matches the monthly report.
// `body` lines are already-escaped/intentional HTML strings.
function shell(opts: {
  eyebrow?: string
  heading: string
  body: string[]
  ctaText?: string
  ctaUrl?: string
  foot?: string
}): string {
  const bodyHtml = opts.body
    .map((p) => `<p style="margin:0 0 14px;color:#d4d4d8;font-size:15px;line-height:1.55;">${p}</p>`)
    .join('')
  const cta =
    opts.ctaText && opts.ctaUrl
      ? `<div style="margin-top:22px;"><a href="${opts.ctaUrl}" style="display:inline-block;background:#d4a333;color:#0a0a0b;font-weight:700;font-size:14px;text-decoration:none;padding:11px 20px;border-radius:9px;">${escapeHtml(opts.ctaText)}</a></div>`
      : ''
  const foot = opts.foot
    ? `<p style="margin:22px 0 0;color:#52525b;font-size:11px;line-height:1.5;">${escapeHtml(opts.foot)}</p>`
    : ''
  return `<!doctype html><html><body style="margin:0;background:#09090b;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#0a0a0b;border:1px solid #27272a;border-radius:14px;overflow:hidden;">
      <tr><td style="padding:24px 28px;border-bottom:1px solid #27272a;">
        <div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#d4a333;font-weight:700;">Loop Network</div>
        ${opts.eyebrow ? `<div style="margin-top:2px;color:#a1a1aa;font-size:13px;">${escapeHtml(opts.eyebrow)}</div>` : ''}
      </td></tr>
      <tr><td style="padding:24px 28px;">
        <div style="margin:0 0 14px;color:#fafafa;font-size:20px;font-weight:700;">${escapeHtml(opts.heading)}</div>
        ${bodyHtml}${cta}${foot}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

// Turn resolved plain-text body paragraphs into HTML-safe lines, with the
// personalized greeting first.
function bodyWithGreeting(name: string | null, paras: string[]): string[] {
  return [greet(name), ...paras.map((p) => escapeHtml(p))]
}

async function ownerEmail(
  admin: Admin,
  userId: string
): Promise<{ email: string; full_name: string | null } | null> {
  const { data } = await admin
    .from('profiles')
    .select('email, full_name')
    .eq('id', userId)
    .maybeSingle()
  if (!data?.email) return null
  return { email: data.email as string, full_name: (data.full_name as string | null) ?? null }
}

// Newest campaign that runs this ad, for a "view your campaign" link.
async function campaignForAd(admin: Admin, adId: string): Promise<string | null> {
  const { data } = await admin
    .from('campaigns')
    .select('id')
    .eq('ad_id', adId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.id as string) ?? null
}

// Ad review outcome. Service-only: tells them it's live, or exactly what to change.
export async function notifyAdReviewed(
  admin: Admin,
  adId: string,
  outcome: { approved: boolean; reason?: string | null }
): Promise<void> {
  const { data: ad } = await admin
    .from('ads')
    .select('title, owner_user_id')
    .eq('id', adId)
    .maybeSingle()
  if (!ad?.owner_user_id) return
  const who = await ownerEmail(admin, ad.owner_user_id as string)
  if (!who) return

  const base = appUrl().replace(/\/$/, '')
  const campaignId = await campaignForAd(admin, adId)
  const dashUrl = campaignId ? `${base}/advertiser/campaigns/${campaignId}` : `${base}/advertiser`
  const title = (ad.title as string) || 'Your ad'

  const resolved = await resolveEmail(admin, outcome.approved ? 'ad_approved' : 'ad_rejected', {
    title,
    reason: outcome.reason || 'not specified',
  })
  if (!resolved.enabled) return

  const html = shell({
    eyebrow: 'Ad review',
    heading: resolved.heading,
    body: bodyWithGreeting(who.full_name, resolved.body),
    ctaText: outcome.approved ? 'View your campaign' : 'Update your ad',
    ctaUrl: dashUrl,
  })

  await sendEmail({ to: who.email, subject: resolved.subject, html })
}

// Payment received (the charge that activates a campaign). A plain service receipt.
export async function notifyPaymentReceived(admin: Admin, campaignId: string): Promise<void> {
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, advertiser_id, ad_id, monthly_total_cents')
    .eq('id', campaignId)
    .maybeSingle()
  if (!campaign?.advertiser_id) return
  const who = await ownerEmail(admin, campaign.advertiser_id as string)
  if (!who) return

  let title = 'Your campaign'
  if (campaign.ad_id) {
    const { data: ad } = await admin
      .from('ads')
      .select('title')
      .eq('id', campaign.ad_id)
      .maybeSingle()
    if (ad?.title) title = ad.title as string
  }
  const amount = campaign.monthly_total_cents
    ? `${formatCents(campaign.monthly_total_cents as number)}/mo`
    : null
  const base = appUrl().replace(/\/$/, '')
  const dashUrl = `${base}/advertiser/campaigns/${campaign.id}`

  const resolved = await resolveEmail(admin, 'payment_received', { title, amount })
  if (!resolved.enabled) return

  const html = shell({
    eyebrow: 'Payment received',
    heading: resolved.heading,
    body: bodyWithGreeting(who.full_name, resolved.body),
    ctaText: 'View your campaign',
    ctaUrl: dashUrl,
    foot: 'You can manage or cancel anytime from your dashboard.',
  })

  await sendEmail({ to: who.email, subject: resolved.subject, html })
}

// Payment failed (a renewal charge Stripe couldn't collect). We pause the ad until
// payment is fixed; this is the heads-up. Service-only, no sell.
export async function notifyPaymentFailed(admin: Admin, campaignId: string): Promise<void> {
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, advertiser_id, ad_id')
    .eq('id', campaignId)
    .maybeSingle()
  if (!campaign?.advertiser_id) return
  const who = await ownerEmail(admin, campaign.advertiser_id as string)
  if (!who) return

  let title = 'Your campaign'
  if (campaign.ad_id) {
    const { data: ad } = await admin
      .from('ads')
      .select('title')
      .eq('id', campaign.ad_id)
      .maybeSingle()
    if (ad?.title) title = ad.title as string
  }
  const base = appUrl().replace(/\/$/, '')
  const dashUrl = `${base}/advertiser/campaigns/${campaign.id}`

  const resolved = await resolveEmail(admin, 'payment_failed', { title })
  if (!resolved.enabled) return

  const html = shell({
    eyebrow: 'Payment issue',
    heading: resolved.heading,
    body: bodyWithGreeting(who.full_name, resolved.body),
    ctaText: 'View your campaign',
    ctaUrl: dashUrl,
    foot: 'If you think this is a mistake, reply to this email and we will help.',
  })

  await sendEmail({ to: who.email, subject: resolved.subject, html })
}

// Campaign created — a confirmation the moment an advertiser sets up a campaign,
// with a short recap (screens + monthly total) and what happens next (payment +
// review, then it goes live). Service-only, no sell. Creates its own admin client
// so the call site can stay on the RLS client. Best-effort; caller wraps it.
export async function notifyCampaignCreated(campaignId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, advertiser_id, ad_id, monthly_total_cents')
    .eq('id', campaignId)
    .maybeSingle()
  if (!campaign?.advertiser_id) return
  const who = await ownerEmail(admin, campaign.advertiser_id as string)
  if (!who) return

  let title = 'Your campaign'
  if (campaign.ad_id) {
    const { data: ad } = await admin
      .from('ads')
      .select('title')
      .eq('id', campaign.ad_id)
      .maybeSingle()
    if (ad?.title) title = ad.title as string
  }

  const { count } = await admin
    .from('campaign_targets')
    .select('venue_id', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
  const screens = count ?? 0
  const amount = campaign.monthly_total_cents
    ? formatCents(campaign.monthly_total_cents as number)
    : null
  const recap = [`${screens} screen${screens === 1 ? '' : 's'}`, amount ? `${amount}/mo` : null]
    .filter(Boolean)
    .join(' · ')

  const base = appUrl().replace(/\/$/, '')
  const dashUrl = `${base}/advertiser/campaigns/${campaign.id}`

  const resolved = await resolveEmail(admin, 'campaign_created', { title, recap })
  if (!resolved.enabled) return

  const html = shell({
    eyebrow: 'Campaign created',
    heading: resolved.heading,
    body: bodyWithGreeting(who.full_name, resolved.body),
    ctaText: 'View your campaign',
    ctaUrl: dashUrl,
    foot: 'You can manage or cancel anytime from your dashboard.',
  })

  await sendEmail({ to: who.email, subject: resolved.subject, html })
}

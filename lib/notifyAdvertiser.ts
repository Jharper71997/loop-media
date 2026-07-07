// Transactional advertiser notifications: short, branded, service-only emails for
// the moments that matter (ad reviewed, payment received). Service/metrics only —
// never a sell or a goal push (Jacob's rule). Best-effort: every send is wrapped
// so a mail failure never blocks the action that triggered it. Server-only.

import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { appUrl } from '@/lib/stripe'
import { formatCents } from '@/lib/format'

type Admin = ReturnType<typeof createAdminClient>

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

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

  const html = outcome.approved
    ? shell({
        eyebrow: 'Ad review',
        heading: `${title} is approved`,
        body: [
          greet(who.full_name),
          `Good news. Your ad cleared review and is set to run on the screens in your campaign. If the campaign is paid and active, it is on the loop now.`,
        ],
        ctaText: 'View your campaign',
        ctaUrl: dashUrl,
      })
    : shell({
        eyebrow: 'Ad review',
        heading: `${title} needs a change`,
        body: [
          greet(who.full_name),
          `Your ad was not approved to run yet.`,
          `Reason: ${escapeHtml(outcome.reason || 'not specified')}.`,
          `Swap the creative from your campaign page and we will review it again.`,
        ],
        ctaText: 'Update your ad',
        ctaUrl: dashUrl,
      })

  await sendEmail({
    to: who.email,
    subject: outcome.approved ? `${title} is approved` : `${title} needs a change`,
    html,
  })
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
    ? formatCents(campaign.monthly_total_cents as number)
    : null
  const base = appUrl().replace(/\/$/, '')
  const dashUrl = `${base}/advertiser/campaigns/${campaign.id}`

  const html = shell({
    eyebrow: 'Payment received',
    heading: "You're all set",
    body: [
      greet(who.full_name),
      `We received your payment${amount ? ` of ${amount} per month` : ''} for ${escapeHtml(
        title
      )}. Your campaign is active and starts showing on screens as soon as your ad is approved.`,
    ],
    ctaText: 'View your campaign',
    ctaUrl: dashUrl,
    foot: 'You can manage or cancel anytime from your dashboard.',
  })

  await sendEmail({ to: who.email, subject: `Payment received for ${title}`, html })
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

  const html = shell({
    eyebrow: 'Payment issue',
    heading: 'We could not process your payment',
    body: [
      greet(who.full_name),
      `Your latest payment for ${escapeHtml(title)} did not go through, so the ad is paused for now.`,
      `Update your payment method and the ad starts running again automatically as soon as the charge clears.`,
    ],
    ctaText: 'View your campaign',
    ctaUrl: dashUrl,
    foot: 'If you think this is a mistake, reply to this email and we will help.',
  })

  await sendEmail({ to: who.email, subject: `Payment issue for ${title}`, html })
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

  const html = shell({
    eyebrow: 'Campaign created',
    heading: `${escapeHtml(title)} is set up`,
    body: [
      greet(who.full_name),
      `Thanks for setting up your campaign${recap ? ` (${escapeHtml(recap)})` : ''}.`,
      `Here is what happens next: once your payment is confirmed and your ad clears our quick review, it starts running on your screens. We will email you at each step.`,
    ],
    ctaText: 'View your campaign',
    ctaUrl: dashUrl,
    foot: 'You can manage or cancel anytime from your dashboard.',
  })

  await sendEmail({ to: who.email, subject: `Your campaign is set up: ${title}`, html })
}

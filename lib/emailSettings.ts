// Central registry + resolver for the app's automated emails.
//
// Each automated email has a row in the email_settings table (migration 0055)
// that an admin edits at /admin/email: an on/off toggle plus optional copy
// overrides (subject / heading / body). A null override means "use the default
// defined here in code". The branded shell, CTA buttons, greeting, and any
// dynamic/data content stay code-owned; overrides are plain text with
// {placeholder} tokens the sender fills in per send.
//
// Every send site should: build its vars, call resolveEmail(), bail when
// !enabled, then render using the returned subject/heading/body. Reads use the
// service-role client so the on/off gate works regardless of RLS. If the table
// isn't there yet (migration not applied) it falls back to enabled + defaults.

import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export type EmailKey =
  | 'campaign_created'
  | 'ad_approved'
  | 'ad_rejected'
  | 'payment_received'
  | 'payment_failed'
  | 'monthly_report'
  | 'host_monthly_report'
  | 'screen_offline'
  | 'screen_live'

export type EmailField = 'subject' | 'heading' | 'body'

export type EmailCatalogEntry = {
  key: EmailKey
  label: string
  audience: 'Advertiser' | 'Host'
  description: string
  // Editable fields shown in the admin editor. The monthly report is a
  // data-driven table, so only its subject is editable.
  fields: EmailField[]
  // Tokens the sender substitutes; shown as hints in the editor.
  placeholders: string[]
  default: { subject: string; heading: string; body: string }
}

// Copy defaults mirror what each send site produced before this registry, minus
// the greeting (callers prepend a personalized one where appropriate).
export const EMAIL_CATALOG: EmailCatalogEntry[] = [
  {
    key: 'campaign_created',
    label: 'Campaign created',
    audience: 'Advertiser',
    description: 'Sent the moment an advertiser sets up a campaign, before payment.',
    fields: ['subject', 'heading', 'body'],
    placeholders: ['title', 'recap'],
    default: {
      subject: 'Your campaign is set up: {title}',
      heading: '{title} is set up',
      body:
        'Thanks for setting up your campaign ({recap}).\n\n' +
        'Here is what happens next: once your payment is confirmed and your ad clears our quick review, it starts running on your screens. We will email you at each step.',
    },
  },
  {
    key: 'ad_approved',
    label: 'Ad approved',
    audience: 'Advertiser',
    description: 'Sent when an admin approves an advertiser’s creative.',
    fields: ['subject', 'heading', 'body'],
    placeholders: ['title'],
    default: {
      subject: '{title} is approved',
      heading: '{title} is approved',
      body:
        'Good news. Your ad cleared review and is set to run on the screens in your campaign. If the campaign is paid and active, it is on the loop now.',
    },
  },
  {
    key: 'ad_rejected',
    label: 'Ad needs a change',
    audience: 'Advertiser',
    description: 'Sent when an admin rejects a creative and asks for a change.',
    fields: ['subject', 'heading', 'body'],
    placeholders: ['title', 'reason'],
    default: {
      subject: '{title} needs a change',
      heading: '{title} needs a change',
      body:
        'Your ad was not approved to run yet.\n\nReason: {reason}.\n\nSwap the creative from your campaign page and we will review it again.',
    },
  },
  {
    key: 'payment_received',
    label: 'Payment received',
    audience: 'Advertiser',
    description: 'Receipt sent when a charge that activates a campaign succeeds.',
    fields: ['subject', 'heading', 'body'],
    placeholders: ['title', 'amount'],
    default: {
      subject: 'Payment received for {title}',
      heading: 'You’re all set',
      body:
        'We received your payment for {title}. Your campaign is active and starts showing on screens as soon as your ad is approved.',
    },
  },
  {
    key: 'payment_failed',
    label: 'Payment failed',
    audience: 'Advertiser',
    description: 'Heads-up when a renewal charge fails and the ad is paused.',
    fields: ['subject', 'heading', 'body'],
    placeholders: ['title'],
    default: {
      subject: 'Payment issue for {title}',
      heading: 'We could not process your payment',
      body:
        'Your latest payment for {title} did not go through, so the ad is paused for now.\n\nUpdate your payment method and the ad starts running again automatically as soon as the charge clears.',
    },
  },
  {
    key: 'monthly_report',
    label: 'Monthly report',
    audience: 'Advertiser',
    description:
      'Monthly ROI report. The body is a data table built from the campaign, so only the subject is editable here.',
    fields: ['subject'],
    placeholders: ['month'],
    default: {
      subject: 'Your {month} Loop Network report',
      heading: '',
      body: '',
    },
  },
  {
    key: 'host_monthly_report',
    label: 'Monthly host recap',
    audience: 'Host',
    description:
      'Monthly "what your screen did for you" recap to hosts (ads shown, local advertisers, own promos, trivia players). The body is a data table built from the venue, so only the subject is editable here.',
    fields: ['subject'],
    placeholders: ['month'],
    default: {
      subject: 'Your {month} Loop screen recap',
      heading: '',
      body: '',
    },
  },
  {
    key: 'screen_offline',
    label: 'Screen offline (host)',
    audience: 'Host',
    description: 'Sent to a host when their screen stops checking in during open hours.',
    fields: ['subject', 'heading', 'body'],
    placeholders: ['venue'],
    default: {
      subject: 'Your Loop screen at {venue} looks offline',
      heading: 'Your screen looks offline',
      body:
        'The Loop screen at {venue} has not checked in for a little while during your open hours. It is usually a quick fix: unplug the Fire Stick, wait a few seconds, plug it back in, and make sure the TV input is on Loop.',
    },
  },
  {
    key: 'screen_live',
    label: 'New screen live',
    audience: 'Advertiser',
    description: 'Announces a newly live screen to advertisers in that market.',
    fields: ['subject', 'heading', 'body'],
    placeholders: ['venue', 'city'],
    default: {
      subject: 'A new screen just went live in {city}',
      heading: 'A new screen is live in {city}.',
      body: '{venue} is now showing the loop. It is on the map if you would like to take a look.',
    },
  },
]

export function emailEntry(key: EmailKey): EmailCatalogEntry {
  const e = EMAIL_CATALOG.find((x) => x.key === key)
  if (!e) throw new Error(`Unknown email key: ${key}`)
  return e
}

// Minimal HTML escape for admin-authored copy + dynamic values rendered into
// email HTML. Subjects are plain text and are NOT escaped.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function fillPlaceholders(
  tpl: string,
  vars: Record<string, string | null | undefined>
): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, k) => {
    const v = vars[k]
    return v == null ? '' : String(v)
  })
}

export type ResolvedEmail = {
  enabled: boolean
  subject: string
  heading: string
  // Body split into paragraphs, placeholder-filled, PLAIN TEXT (callers escape
  // when rendering into HTML). Excludes the greeting, which callers add.
  body: string[]
  // Whether each field came from an admin override (vs the code default) — lets a
  // caller keep its richer code default (e.g. the report subject) unless overridden.
  custom: { subject: boolean; heading: boolean; body: boolean }
}

export async function resolveEmail(
  admin: AdminClient,
  key: EmailKey,
  vars: Record<string, string | null | undefined> = {}
): Promise<ResolvedEmail> {
  const entry = emailEntry(key)

  type SettingsRow = {
    enabled: boolean | null
    subject: string | null
    heading: string | null
    body: string | null
  }

  let row: SettingsRow | null = null
  try {
    const { data } = await admin
      .from('email_settings')
      .select('enabled, subject, heading, body')
      .eq('key', key)
      .maybeSingle()
    row = (data as SettingsRow | null) ?? null
  } catch {
    row = null
  }

  const enabled = row ? row.enabled !== false : true
  const subjectTpl = row?.subject ?? entry.default.subject
  const headingTpl = row?.heading ?? entry.default.heading
  const bodyTpl = row?.body ?? entry.default.body

  return {
    enabled,
    subject: fillPlaceholders(subjectTpl, vars),
    heading: fillPlaceholders(headingTpl, vars),
    body: bodyTpl
      .split(/\n{2,}/)
      .map((p) => fillPlaceholders(p.trim(), vars))
      .filter(Boolean),
    custom: {
      subject: row?.subject != null,
      heading: row?.heading != null,
      body: row?.body != null,
    },
  }
}

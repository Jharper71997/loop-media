'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rateLimit'
import { isEmailish } from '@/lib/messaging'
import { firstStage } from '@/lib/pipeline'

// The public enquiry form.
//
// Unauthenticated and writing to the sales pipeline, so it is the most exposed
// surface in this feature. Three guards:
//
//   1. Rate limited per IP.
//   2. A honeypot field no human sees. Bots fill every input they find; a filled
//      honeypot returns success and writes nothing, so the bot has no signal that
//      it was caught.
//   3. Everything is length-capped before it reaches the database.
//
// It never reveals whether a business is already on the board — an enquiry from
// a duplicate is accepted and simply lands as a second card for a human to merge.

const MAX = { name: 120, contact: 120, email: 160, phone: 40, city: 80, message: 2000 }

export type InquiryResult = { ok: boolean; error?: string }

export async function submitInquiry(input: {
  businessName: string
  contactName: string
  email: string
  phone: string
  city: string
  message: string
  kind: 'advertiser' | 'host'
  // Honeypot. Named plausibly so a bot fills it in.
  website?: string
}): Promise<InquiryResult> {
  if (input.website?.trim()) return { ok: true }

  const businessName = input.businessName?.trim().slice(0, MAX.name)
  if (!businessName) return { ok: false, error: 'Tell us the business name.' }

  const email = input.email?.trim().slice(0, MAX.email)
  const phone = input.phone?.trim().slice(0, MAX.phone)
  if (!email && !phone) {
    return { ok: false, error: 'Leave an email or a phone number so we can reply.' }
  }
  if (email && !isEmailish(email)) {
    return { ok: false, error: 'That email address does not look right.' }
  }

  const hdrs = await headers()
  const ip =
    hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? hdrs.get('x-real-ip')?.trim() ?? 'unknown'
  const allowed = await rateLimit('inquiry', ip, 5, 3600)
  if (!allowed) {
    return { ok: false, error: 'That is a lot of enquiries from one place. Try again later.' }
  }

  const admin = createAdminClient()

  // Land it in the market whose name matches the city they typed, else the
  // first real market. An enquiry pointed at the wrong board is recoverable;
  // one that fails to save is not.
  const { data: terrData } = await admin
    .from('territories')
    .select('id, name')
    .eq('is_holding', false)
    .order('name')
  const territories = (terrData ?? []) as { id: string; name: string }[]
  if (!territories.length) return { ok: false, error: 'We are not set up in any market yet.' }

  const city = input.city?.trim().slice(0, MAX.city) ?? ''
  const match = city
    ? territories.find((t) => t.name.toLowerCase().includes(city.toLowerCase().split(',')[0].trim()))
    : null
  const territoryId = (match ?? territories[0]).id

  const kind = input.kind === 'host' ? 'host' : 'advertiser'
  const message = input.message?.trim().slice(0, MAX.message) ?? ''

  const { data, error } = await admin
    .from('opportunities')
    .insert({
      territory_id: territoryId,
      kind,
      business_name: businessName,
      contact_name: input.contactName?.trim().slice(0, MAX.contact) || null,
      email: email || null,
      phone: phone || null,
      city: city || null,
      stage: firstStage(kind),
      source: 'inbound',
      // Inbound is the warmest lead there is, so it arrives with a follow-up
      // already due rather than waiting to be noticed.
      next_step: 'Reply to their enquiry',
      next_step_at: new Date().toISOString(),
      last_touch_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    console.error('[inquiry] failed to save:', error)
    return { ok: false, error: 'Something went wrong on our end. Try again in a moment.' }
  }

  await admin.from('opportunity_events').insert({
    opportunity_id: data.id,
    kind: 'note',
    body: message
      ? `Enquiry from the website:\n\n${message}`
      : 'Enquiry from the website, no message left.',
  })

  revalidatePath('/admin')
  revalidatePath('/admin/pipeline')
  return { ok: true }
}

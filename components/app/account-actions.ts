'use server'

import { requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripe, appUrl } from '@/lib/stripe'

// Open a Stripe Customer Portal session so the advertiser can update their card,
// see invoices, or cancel — the "update your payment method" the past-due banner
// keeps pointing at. Uses the Stripe customer already on file from any of their
// campaign subscriptions. `returnPath` is where Stripe sends them back (e.g.
// '/advertiser/account').
export async function openBillingPortal(
  returnPath: string
): Promise<{ error?: string; url?: string }> {
  const profile = await requireProfile()
  if (!process.env.STRIPE_SECRET_KEY) return { error: 'Payments are not configured.' }

  const admin = createAdminClient()
  const { data } = await admin
    .from('subscriptions')
    .select('stripe_customer_id, created_at')
    .eq('advertiser_id', profile.id)
    .not('stripe_customer_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const customer = data?.stripe_customer_id
  if (!customer) {
    return { error: 'No billing is set up yet — it appears once your first campaign is paid.' }
  }

  const safeReturn = returnPath.startsWith('/') ? returnPath : '/advertiser/account'
  try {
    const session = await stripe().billingPortal.sessions.create({
      customer,
      return_url: `${appUrl()}${safeReturn}`,
    })
    return { url: session.url }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not open billing.' }
  }
}

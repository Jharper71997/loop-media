import { requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasUnlimitedChanges } from '@/lib/membership'
import { AccountScreen } from '@/components/app/AccountScreen'

export default async function AdvertiserAccountPage() {
  const profile = await requireProfile()
  const admin = createAdminClient()

  // Any subscription with a Stripe customer means billing management is available;
  // a past_due one prioritizes the "update your card" call to action.
  const { data: subs } = await admin
    .from('subscriptions')
    .select('stripe_customer_id, status')
    .eq('advertiser_id', profile.id)
  const hasCustomer = (subs ?? []).some((s) => !!s.stripe_customer_id)
  const pastDue = (subs ?? []).some((s) => s.status === 'past_due')
  const isMember = await hasUnlimitedChanges(admin, profile.id)

  return (
    <AccountScreen
      email={profile.email}
      role={profile.role}
      links={[{ href: '/advertiser/past', label: 'Past campaigns' }]}
      billing={{
        returnPath: '/advertiser/account',
        membershipBasePath: '/advertiser',
        hasCustomer,
        pastDue,
        isMember,
      }}
    />
  )
}

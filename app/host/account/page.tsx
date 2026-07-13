import { requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasUnlimitedChanges } from '@/lib/membership'
import { AccountScreen } from '@/components/app/AccountScreen'
import { ReplayHostTourButton } from '@/components/app/tour/ReplayHostTourButton'

export default async function HostAccountPage() {
  const profile = await requireProfile()
  const admin = createAdminClient()

  // Hosts can also advertise (from /host/advertise), so they may have billing too.
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
      profile={{ userId: profile.id, fullName: profile.full_name, phone: profile.phone }}
      extra={<ReplayHostTourButton />}
      billing={{
        returnPath: '/host/account',
        membershipBasePath: '/host/advertise',
        hasCustomer,
        pastDue,
        isMember,
        // Pure hosts (not advertising) have no ads to change — hide the upsell.
        showMembership: hasCustomer || isMember,
      }}
    />
  )
}

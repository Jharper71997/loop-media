import { requireAdmin } from '@/lib/auth'
import { AccountScreen } from '@/components/app/AccountScreen'
import { ResetDemoButton } from '@/components/admin/ResetDemoButton'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, SETUP_TABS } from '@/components/admin/SectionTabs'

export default async function AdminAccountPage() {
  const profile = await requireAdmin()
  return (
    <>
      <PageHeader title="Setup" description="Your admin login and the sales demo" />
      <SectionTabs tabs={SETUP_TABS} />
      <div className="mx-auto max-w-md space-y-4 p-3 md:p-4">
      <AccountScreen
        email={profile.email}
        role="admin"
        profile={{ userId: profile.id, fullName: profile.full_name, phone: profile.phone }}
      />

      <div className="space-y-2 rounded-lg border border-border p-4">
        <p className="text-sm font-medium">Sales demo</p>
        <p className="text-xs text-muted-foreground">
          Walk a prospect through the real sign-up: send{' '}
          <span className="font-mono">loopnetwork.org/demo/host</span> or{' '}
          <span className="font-mono">/demo/advertiser</span>, or open it yourself to screen-share.
          Nothing there is real and no card is ever charged. Use this to clear every throwaway demo
          account.
        </p>
        <ResetDemoButton />
      </div>
      </div>
    </>
  )
}

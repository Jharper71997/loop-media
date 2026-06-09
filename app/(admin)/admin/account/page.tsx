import { requireAdmin } from '@/lib/auth'
import { AccountScreen } from '@/components/app/AccountScreen'

export default async function AdminAccountPage() {
  const profile = await requireAdmin()
  return (
    <div className="mx-auto max-w-md p-5 md:p-6">
      <AccountScreen email={profile.email} role="admin" />
    </div>
  )
}

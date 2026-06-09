import { requireProfile } from '@/lib/auth'
import { AccountScreen } from '@/components/app/AccountScreen'

export default async function HostAccountPage() {
  const profile = await requireProfile()
  return <AccountScreen email={profile.email} role={profile.role} />
}

import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { AdminNav } from '@/components/admin/AdminNav'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AdminNav profile={profile} territory={territory} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}

import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { AdminNav } from '@/components/admin/AdminNav'
import { CommandPalette } from '@/components/admin/CommandPalette'
import { loadAdminInbox } from '@/lib/adminInbox'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)

  // Live sidebar counts, from the same inbox the Today page renders — so the
  // badge and the list can never disagree. loadAdminInbox is React-cached, so
  // this costs nothing extra when /admin is the page being rendered.
  const { counts } = await loadAdminInbox(territory.activeId)

  const badges: Record<string, number> = {
    // Today = the work that only moves if you touch it: ads awaiting review,
    // creative we owe an advertiser, and anything paid that never activated.
    '/admin': counts.approvals + counts.creative + counts.activation,
    // Advertisers = follow-ups you promised that are due or overdue.
    '/admin/advertisers': counts.followup,
    // Money = accounts that are live but unbilled, overdue, or about to lapse.
    '/admin/money': counts.billing,
    // Screens = paired screens that have gone dark at a live venue.
    '/admin/venues': counts.offline,
  }

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <CommandPalette />
      <AdminNav profile={profile} territory={territory} counts={badges} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}

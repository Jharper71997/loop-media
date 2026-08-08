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
  // badge and the list can never disagree.
  //
  // NOT awaited. This is the layout: awaiting it here put half a dozen queries
  // in front of the first pixel of every admin page, including the route's own
  // loading skeleton, because a skeleton lives *inside* the layout and cannot
  // render until the layout resolves. The shell now paints immediately and the
  // badges — which are decoration on a nav that works without them — resolve
  // into it. The promise is passed down rather than awaited; AdminNav reads it
  // with `use()` behind its own Suspense boundary.
  const badges = loadAdminInbox(territory.activeId).then(({ counts }) => ({
    // Today = the work that only moves if you touch it: ads awaiting review,
    // creative we owe an advertiser, and anything paid that never activated.
    '/admin': counts.approvals + counts.creative + counts.activation,
    // Advertisers = follow-ups you promised that are due or overdue.
    '/admin/advertisers': counts.followup,
    // Money = accounts that are live but unbilled, overdue, or about to lapse.
    '/admin/money': counts.billing,
    // Screens = paired screens that have gone dark at a live venue.
    '/admin/venues': counts.offline,
  }))

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <CommandPalette />
      <AdminNav profile={profile} territory={territory} countsPromise={badges} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}

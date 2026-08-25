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
  // Keyed to the verbs in AdminNav, so a badge counts the work that verb is FOR.
  const badges = loadAdminInbox(territory.activeId).then(({ counts }) => ({
    // Watch = something is actually broken: screens dark at a live venue.
    '/admin': counts.offline,
    // Sell = follow-ups you promised that are due or overdue.
    '/admin/sell': counts.followup,
    // Ship = an ad that cannot go live until you touch it: awaiting review,
    // creative we owe an advertiser, and anything paid that never activated.
    '/admin/ship': counts.approvals + counts.creative + counts.activation,
    // More = accounts that are live but unbilled, overdue, or about to lapse.
    '/admin/more': counts.billing,
  }))

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <CommandPalette />
      <AdminNav profile={profile} territory={territory} countsPromise={badges} />
      {/* pb-16 clears the phone tab bar, which is fixed and would otherwise sit
          on top of the last row of every list. */}
      <main className="min-w-0 flex-1 pb-16 md:pb-0">{children}</main>
    </div>
  )
}

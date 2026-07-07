import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { AdminNav } from '@/components/admin/AdminNav'
import { CommandPalette } from '@/components/admin/CommandPalette'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const supabase = await createClient()
  const t = territory.activeId

  // Live sidebar counts — the operator sees what's waiting without visiting each
  // page. Queue (biggest win) is territory-scoped like the queue page itself;
  // creative-help + needs-activation are network-wide.
  let queueQ = supabase.from('ads').select('id', { count: 'exact', head: true }).eq('status', 'pending')
  if (t) queueQ = queueQ.eq('territory_id', t)
  const [queueRes, creativeRes, draftPaidRes] = await Promise.all([
    queueQ,
    supabase
      .from('creative_requests')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'done'),
    supabase
      .from('subscriptions')
      .select('id, campaign:campaigns(status)')
      .in('status', ['active', 'past_due']),
  ])
  const needsActivation = (
    (draftPaidRes.data ?? []) as { campaign: { status: string } | { status: string }[] | null }[]
  ).filter((s) => {
    const camp = Array.isArray(s.campaign) ? s.campaign[0] : s.campaign
    return camp?.status === 'draft'
  }).length

  const counts: Record<string, number> = {
    '/admin/queue': queueRes.count ?? 0,
    '/admin/creative': creativeRes.count ?? 0,
    '/admin/revenue': needsActivation,
  }

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <CommandPalette />
      <AdminNav profile={profile} territory={territory} counts={counts} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}

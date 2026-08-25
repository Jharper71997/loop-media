import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, SELL_TABS } from '@/components/admin/SectionTabs'
import { HudBody } from '@/components/admin/hud'
import { loadBillingRows } from '@/lib/adminInbox'
import { loadAdResults, loadCases } from '@/lib/cases'
import type { Profile } from '@/lib/db.types'
import { AdvertiserTable, type AdvertiserRow } from './AdvertiserTable'

// The advertiser roster.
//
// Everything below the profile row already existed somewhere else in the admin
// and was never joined to the account it describes: billing health lived on
// Money keyed by campaign, measured delivery lived on the case pages keyed by
// campaign, and open problems lived on Today keyed by whatever the case was
// about. Three loaders, all React-cached, all already running elsewhere in the
// request — assembling them here costs almost nothing and is the difference
// between a contact list and a roster you can run a business from.

export default async function AdvertisersPage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  let q = supabase
    .from('profiles')
    .select('*')
    .eq('role', 'advertiser')
    // Demo accounts never appear in the admin roster.
    .eq('is_demo', false)
    .order('created_at', { ascending: false })
  if (t) q = q.eq('territory_id', t)

  // Deactivated advertisers are a Supabase auth ban (our reversible "on hold"
  // flag, stored on auth.users rather than in our schema).
  //
  // NOTE: this is an unpaginatable GoTrue call with a hard 1,000-user ceiling.
  // The clean fix is a profiles.deactivated_at column, which needs a migration —
  // so it waits until the queued ones are applied. Until then it at least runs
  // alongside the rest instead of after them; it used to sit at the end of the
  // chain, adding its whole round trip to the page's time on its own.
  const deactivatedIds = createAdminClient()
    .auth.admin.listUsers({ perPage: 1000 })
    .then(({ data: authList }) => {
      const nowMs = Date.now()
      const out = new Set<string>()
      for (const u of authList?.users ?? []) {
        const banned = (u as { banned_until?: string | null }).banned_until
        if (banned && new Date(banned).getTime() > nowMs) out.add(u.id)
      }
      return out
    })
    // If the lookup fails, show everyone as active rather than hard-fail.
    .catch(() => new Set<string>())

  const [{ data }, billing, results, { cases }, deactivated] = await Promise.all([
    q,
    loadBillingRows(t),
    loadAdResults(t),
    loadCases(t),
    deactivatedIds,
  ])
  let advertisers = (data ?? []) as Profile[]

  // Anyone with a live campaign belongs on this page, whatever their profile
  // role says. Filtering on role='advertiser' alone hid two accounts that are
  // running ads on real screens right now — they were created as hosts and then
  // sold advertising, so the roster you use to run the business was missing the
  // people you are actually running. Pull in whoever billing knows about.
  const known = new Set(advertisers.map((a) => a.id))
  const missing = [...new Set(billing.map((b) => b.advertiserId))].filter((id) => !known.has(id))
  if (missing.length) {
    const { data: extra } = await supabase.from('profiles').select('*').in('id', missing)
    advertisers = [...advertisers, ...((extra ?? []) as Profile[]).filter((p) => !p.is_demo)]
  }

  const ids = advertisers.map((a) => a.id)

  // Ad counts per owner.
  const adsByOwner = new Map<string, { total: number; pending: number; live: number }>()
  if (ids.length) {
    const { data: ads } = await supabase
      .from('ads')
      .select('owner_user_id, status')
      .eq('owner_kind', 'advertiser')
      .in('owner_user_id', ids)
    for (const ad of (ads ?? []) as { owner_user_id: string; status: string }[]) {
      const cur = adsByOwner.get(ad.owner_user_id) ?? { total: 0, pending: 0, live: 0 }
      cur.total++
      if (ad.status === 'pending') cur.pending++
      if (ad.status === 'active' || ad.status === 'approved') cur.live++
      adsByOwner.set(ad.owner_user_id, cur)
    }
  }

  // Billing is keyed by campaign; an advertiser can hold more than one. Take the
  // worst health, because that is the one that needs doing something about, and
  // sum the money, because that is what the account is worth.
  const HEALTH_ORDER = { unbilled: 0, overdue: 1, due: 2, ok: 3 } as const
  const byAdvertiser = new Map<string, (typeof billing)[number][]>()
  for (const row of billing) {
    byAdvertiser.set(row.advertiserId, [...(byAdvertiser.get(row.advertiserId) ?? []), row])
  }

  // Delivery is keyed by campaign too; roll it up the same way.
  const deliveryByAdvertiser = new Map<string, { plays: number; scans: number; screens: number }>()
  for (const r of results) {
    const cur = deliveryByAdvertiser.get(r.advertiserId) ?? { plays: 0, scans: 0, screens: 0 }
    cur.plays += r.plays
    cur.scans += r.scans
    cur.screens += r.screens
    deliveryByAdvertiser.set(r.advertiserId, cur)
  }

  // Cases are keyed by whatever the problem is about — a campaign for the money
  // and delivery kinds, a screen or venue for the rest. Only the campaign-keyed
  // ones belong to an advertiser, so map through their campaigns.
  const advertiserByCampaign = new Map(billing.map((b) => [b.campaignId, b.advertiserId]))
  const casesByAdvertiser = new Map<string, number>()
  for (const c of cases) {
    const advertiserId = advertiserByCampaign.get(c.subjectId)
    if (!advertiserId) continue
    casesByAdvertiser.set(advertiserId, (casesByAdvertiser.get(advertiserId) ?? 0) + 1)
  }

  const rows: AdvertiserRow[] = advertisers.map((a) => {
    const theirs = byAdvertiser.get(a.id) ?? []
    const worst = [...theirs].sort(
      (x, y) => HEALTH_ORDER[x.billing.health] - HEALTH_ORDER[y.billing.health]
    )[0]
    const counts = adsByOwner.get(a.id) ?? { total: 0, pending: 0, live: 0 }
    const delivery = deliveryByAdvertiser.get(a.id) ?? { plays: 0, scans: 0, screens: 0 }
    return {
      id: a.id,
      name: a.full_name ?? a.email,
      email: a.email,
      phone: a.phone,
      joinedAt: a.created_at,
      ads: counts.total,
      pendingAds: counts.pending,
      liveAds: counts.live,
      screens: delivery.screens,
      plays: delivery.plays,
      scans: delivery.scans,
      monthlyCents: theirs.reduce((s, r) => s + r.monthlyCents, 0),
      method: worst?.billing.method ?? null,
      health: worst?.billing.health ?? null,
      billingSummary: worst?.billing.summary ?? null,
      openCases: casesByAdvertiser.get(a.id) ?? 0,
      deactivated: deactivated.has(a.id),
    }
  })

  const live = rows.filter((r) => !r.deactivated)
  const payingCents = live
    .filter((r) => r.method && r.method !== 'comp' && r.method !== 'unbilled')
    .reduce((s, r) => s + r.monthlyCents, 0)

  return (
    <>
      <PageHeader
        title="Advertisers"
        description={`${live.length} account${live.length === 1 ? '' : 's'} · ${(payingCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })}/mo billed`}
      />
      <SectionTabs tabs={SELL_TABS} />
      <HudBody>
        <AdvertiserTable rows={rows} />
      </HudBody>
    </>
  )
}

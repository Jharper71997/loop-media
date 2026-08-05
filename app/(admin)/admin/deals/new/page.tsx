import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { loadInventory } from '@/lib/inventory'
import { getPricingConfig } from '@/lib/pricing.server'
import { NewDealForm, type DealVenue, type DealAdvertiser } from './NewDealForm'
import type { Category } from '@/lib/db.types'

// Close a deal you sold in person.
//
// This is the page the admin never had: an advertiser who was sold offline had
// to be assembled by hand across five tables in the Supabase dashboard. One form
// now walks the whole thing — who bought, what runs, where, and how they pay.

export default async function NewDealPage({
  searchParams,
}: {
  searchParams: Promise<{ venue?: string; advertiser?: string; opportunity?: string }>
}) {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const {
    venue: presetVenue,
    advertiser: presetAdvertiser,
    opportunity: presetOpportunity,
  } = await searchParams
  const supabase = await createClient()

  const [inventory, config, { data: advData }, { data: catData }] = await Promise.all([
    loadInventory(t),
    getPricingConfig(),
    supabase
      .from('profiles')
      .select('id, full_name, email, category_id')
      .eq('role', 'advertiser')
      .eq('is_demo', false)
      .order('full_name'),
    supabase.from('categories').select('*').order('name'),
  ])

  const advertisers = ((advData ?? []) as DealAdvertiser[]).map((a) => ({
    id: a.id,
    full_name: a.full_name,
    email: a.email,
    category_id: a.category_id,
  }))

  const venues: DealVenue[] = inventory.rows
    .filter((r) => r.active)
    .map((r) => ({
      id: r.venueId,
      name: r.name,
      city: r.city,
      priceCents: r.priceCents,
      open: r.open,
      totalSlots: r.totalSlots,
      screens: r.screens.length,
      ownCategoryName: r.ownCategory,
      runningTitles: r.runningTitles,
    }))

  // A venue's own line of business blocks competitors, so the form needs the
  // category ID (not just the name) to grey the right rows out as you pick.
  const { data: venueCats } = await supabase
    .from('venues')
    .select('id, category_id')
    .in('id', venues.length ? venues.map((v) => v.id) : ['00000000-0000-0000-0000-000000000000'])
  const catByVenue = new Map(
    ((venueCats ?? []) as { id: string; category_id: string | null }[]).map((v) => [
      v.id,
      v.category_id,
    ])
  )
  for (const v of venues) v.ownCategoryId = catByVenue.get(v.id) ?? null

  const territoryId = t ?? territory.territories[0]?.id ?? ''

  // Opened from a won opportunity: carry the prospect's details across so nothing
  // is retyped. Silently ignored if the pipeline tables do not exist yet.
  let presetNewAdvertiser: { fullName: string; email: string; phone: string } | null = null
  if (presetOpportunity) {
    const { data: opp } = await supabase
      .from('opportunities')
      .select('business_name, contact_name, email, phone')
      .eq('id', presetOpportunity)
      .maybeSingle()
    const o = opp as {
      business_name: string
      contact_name: string | null
      email: string | null
      phone: string | null
    } | null
    if (o) {
      presetNewAdvertiser = {
        fullName: o.business_name,
        email: o.email ?? '',
        phone: o.phone ?? '',
      }
    }
  }

  return (
    <>
      <PageHeader
        title="New deal"
        description="Set up an advertiser you closed offline — account, creative, locations and billing"
      />

      <div className="space-y-4 p-3 md:p-4">
        <Link
          href="/admin/sell"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to Sell
        </Link>

        {venues.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            There are no active locations to sell yet. Add a venue and a screen first.
          </p>
        ) : (
          <NewDealForm
            advertisers={advertisers}
            categories={(catData ?? []) as Category[]}
            venues={venues}
            pricingConfig={config}
            territoryId={territoryId}
            presetVenueId={presetVenue ?? null}
            presetAdvertiserId={presetAdvertiser ?? null}
            presetOpportunityId={presetOpportunity ?? null}
            presetNewAdvertiser={presetNewAdvertiser}
          />
        )}
      </div>
    </>
  )
}

import { notFound } from 'next/navigation'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent } from '@/components/ui/card'
import { BackLink } from '@/components/app/BackLink'
import { LogoUploader } from '../LogoUploader'
import { EditVenueForm, type EditVenueInitial } from '../EditVenueForm'

export default async function EditVenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await requireProfile()
  const admin = createAdminClient()

  // Load the venue with the admin client (venues is admin-write; also lets us read
  // the service-role-only provisioning row), then enforce ownership in app code.
  const { data: venue } = await admin
    .from('venues')
    .select(
      'id, name, address, city, state, postal_code, category_id, venue_type, median_daily_customers, contact_phone, business_open, business_close, business_days, logo_url, host_user_id'
    )
    .eq('id', id)
    .maybeSingle()
  if (!venue) notFound()
  if (profile.role !== 'admin' && venue.host_user_id !== profile.id) notFound()

  // Network details (private). Password is deliberately NOT read into the page.
  const { data: prov } = await admin
    .from('venue_provisioning')
    .select('network_type, wifi_ssid, network_note')
    .eq('venue_id', id)
    .maybeSingle()

  const supabase = await createClient()
  const { data: cats } = await supabase.from('categories').select('id, name').order('name')
  const categories = (cats ?? []) as { id: string; name: string }[]

  const initial: EditVenueInitial = {
    id: venue.id,
    name: venue.name ?? '',
    address: venue.address ?? '',
    city: venue.city ?? '',
    state: venue.state ?? '',
    postal_code: venue.postal_code ?? '',
    category_id: venue.category_id ?? null,
    venue_type: venue.venue_type ?? '',
    median_daily_customers: venue.median_daily_customers ?? null,
    contact_phone: venue.contact_phone ?? '',
    business_open: venue.business_open ?? '10:00',
    business_close: venue.business_close ?? '22:00',
    business_days: venue.business_days ?? [0, 1, 2, 3, 4, 5, 6],
    network_type: prov?.network_type === 'ethernet' ? 'ethernet' : 'wifi',
    wifi_ssid: prov?.wifi_ssid ?? '',
    network_note: prov?.network_note ?? '',
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackLink href="/host" label="Back to dashboard" />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit {venue.name}</h1>
        <p className="text-sm text-muted-foreground">
          Update your logo and the details you gave when you registered. Your logo shows on the
          advertiser map, so a real logo gives your venue more credibility.
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          <LogoUploader venueId={venue.id} userId={profile.id} initialLogoUrl={venue.logo_url} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <EditVenueForm venue={initial} categories={categories} />
        </CardContent>
      </Card>
    </div>
  )
}

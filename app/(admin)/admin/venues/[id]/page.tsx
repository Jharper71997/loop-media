import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { ArrowLeft, ChevronRight, Mail, Phone, User, MapPin } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { kioskUrl, pairingUrl } from '@/lib/tv'
import { PageHeader } from '@/components/admin/PageHeader'
import { DeleteButton } from '@/components/admin/DeleteButton'
import { Card, CardContent } from '@/components/ui/card'
import { LiveStatus } from '@/components/app/LiveStatus'
import { CopyField } from '@/components/app/CopyField'
import { AutoRefresh } from '@/components/app/AutoRefresh'
import { formatNumber, formatCents, timeAgo, isTvLive } from '@/lib/format'
import { suggestTier, venuePriceCents, TIER_LABEL } from '@/lib/pricing'
import { getPricingConfig } from '@/lib/pricing.server'
import type { Venue, Tv, Category, Territory, PriceTier } from '@/lib/db.types'
import { TvDialog } from '../../tvs/TvDialog'
import { deleteTv } from '../../tvs/actions'
import { VenueDialog } from '../VenueDialog'
import { VisibilityToggle } from '../VisibilityToggle'
import { deleteVenue } from '../actions'

type VenueFull = Venue & {
  category: { name: string } | null
  territory: { name: string } | null
}

// WiFi/network details live in a service-role-only table (the password is a
// secret); this page is requireAdmin-gated so it reads them with the admin client.
type ProvisioningInfo = {
  wifi_ssid: string | null
  wifi_password: string | null
  network_type: string | null
  network_note: string | null
}

const venueTier = (v: { price_tier: PriceTier | null; foot_traffic_estimate: number }): PriceTier =>
  v.price_tier ?? suggestTier(v.foot_traffic_estimate)

export default async function VenueDetail({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin()
  const { id } = await params
  const territoryCtx = await getTerritoryContext(profile)
  const supabase = await createClient()
  const pricingConfig = await getPricingConfig()

  const { data: venueData } = await supabase
    .from('venues')
    .select('*, category:categories(name), territory:territories(name)')
    .eq('id', id)
    .maybeSingle()
  if (!venueData) notFound()
  const venue = venueData as unknown as VenueFull

  // Screens at this venue + how many ads each is running right now.
  const { data: tvData } = await supabase
    .from('tvs')
    .select('*')
    .eq('venue_id', id)
    .order('created_at', { ascending: false })
  const tvs = (tvData ?? []) as Tv[]

  const adsByTv = new Map<string, number>()
  if (tvs.length) {
    const { data: pl } = await supabase
      .from('ad_placements')
      .select('tv_id')
      .in('tv_id', tvs.map((t) => t.id))
      .eq('status', 'active')
    for (const p of pl ?? []) adsByTv.set(p.tv_id, (adsByTv.get(p.tv_id) ?? 0) + 1)
  }
  const liveCount = tvs.filter((t) => !!t.device_id && isTvLive(t.last_heartbeat_at)).length

  // Kiosk-URL origin from the live request + this venue's WiFi/network details, so
  // each screen's Setup block below matches the screen detail page (pairing code /
  // kiosk link + WiFi to program). Provisioning is per-venue, shared by its screens.
  const h = await headers()
  const reqHost = h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const origin = reqHost ? `${proto}://${reqHost}` : (process.env.NEXT_PUBLIC_APP_URL ?? '')

  let provisioning: ProvisioningInfo | null = null
  const { data: prov } = await createAdminClient()
    .from('venue_provisioning')
    .select('wifi_ssid, wifi_password, network_type, network_note')
    .eq('venue_id', venue.id)
    .maybeSingle()
  provisioning = (prov as ProvisioningInfo | null) ?? null

  // For the edit dialog.
  const [{ data: cats }, { data: hostProfiles }] = await Promise.all([
    supabase.from('categories').select('*').order('name'),
    supabase.from('profiles').select('id, email, full_name').in('role', ['host', 'admin']).order('email'),
  ])
  const categories = (cats ?? []) as Category[]
  const territories = territoryCtx.territories as Territory[]
  const hosts = (hostProfiles ?? []) as { id: string; email: string; full_name: string | null }[]

  const tier = venueTier(venue)
  const hasContact = venue.contact_name || venue.contact_email || venue.contact_phone

  return (
    <>
      <PageHeader
        title={venue.name}
        description={venue.venue_type ?? 'Venue'}
        action={
          <div className="flex items-center gap-1">
            <VisibilityToggle id={venue.id} active={venue.status === 'active'} />
            <VenueDialog
              venue={venue}
              categories={categories}
              territories={territories}
              hosts={hosts}
              defaultTerritoryId={venue.territory_id}
              pricingConfig={pricingConfig}
            />
            <DeleteButton id={venue.id} action={deleteVenue} />
          </div>
        }
      />

      <div className="space-y-4 p-3 md:p-4">
        <AutoRefresh seconds={20} />
        <Link
          href="/admin/venues"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> All venues
        </Link>

        {/* At-a-glance stats */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-3">
              <p className="text-sm text-muted-foreground">Screens live</p>
              <p className="mt-1 font-heading text-2xl font-bold tabular-nums">
                {liveCount}/{tvs.length}
              </p>
              <p className="text-xs text-muted-foreground">
                {venue.status === 'active' ? 'On the map' : 'Hidden — not on map'}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-sm text-muted-foreground">Price / mo</p>
              <p className="mt-1 font-heading text-2xl font-bold tabular-nums">
                {formatCents(venuePriceCents(venue.price_cents_override, tier, pricingConfig))}
              </p>
              <p className="text-xs text-muted-foreground">
                {venue.price_cents_override != null ? 'Custom price' : TIER_LABEL[tier]}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-sm text-muted-foreground">Monthly traffic</p>
              <p className="mt-1 font-heading text-2xl font-bold tabular-nums">
                {formatNumber(venue.foot_traffic_estimate)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-sm text-muted-foreground">Category</p>
              <p className="mt-1 font-heading text-lg font-bold">{venue.category?.name ?? '—'}</p>
              <p className="text-xs text-muted-foreground">
                {venue.category_slots} slot{venue.category_slots === 1 ? '' : 's'} per category
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Location + contact */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="space-y-2 p-5">
              <p className="text-sm font-medium">Location</p>
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0" />
                <span>
                  {venue.address ?? 'No address set'}
                  {venue.lat != null && venue.lng != null && (
                    <span className="block text-xs">
                      {venue.lat.toFixed(5)}, {venue.lng.toFixed(5)}
                    </span>
                  )}
                </span>
              </p>
              {!territoryCtx.activeId && venue.territory?.name && (
                <p className="text-xs text-muted-foreground">Market: {venue.territory.name}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2 p-5">
              <p className="text-sm font-medium">Venue contact</p>
              {hasContact ? (
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  {venue.contact_name && (
                    <p className="flex items-center gap-2">
                      <User className="size-4 shrink-0" /> {venue.contact_name}
                    </p>
                  )}
                  {venue.contact_email && (
                    <a
                      href={`mailto:${venue.contact_email}`}
                      className="flex items-center gap-2 hover:text-foreground"
                    >
                      <Mail className="size-4 shrink-0" /> {venue.contact_email}
                    </a>
                  )}
                  {venue.contact_phone && (
                    <a
                      href={`tel:${venue.contact_phone}`}
                      className="flex items-center gap-2 hover:text-foreground"
                    >
                      <Phone className="size-4 shrink-0" /> {venue.contact_phone}
                    </a>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No contact yet. Use Edit to add one.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Screens — tap into any one */}
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">
                Screens ({tvs.length})
              </p>
              <TvDialog venues={[{ id: venue.id, name: venue.name }]} />
            </div>

            {tvs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  No screens here yet. Add one to generate a pairing code.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {tvs.map((tv) => (
                  <div key={tv.id} className="rounded-lg border border-border p-4">
                    {/* Header: code + loop + live status, with a link into the screen */}
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                            {tv.pairing_code ?? '—'}
                          </code>
                          <span className="text-xs text-muted-foreground">
                            {Math.max(1, Math.floor(tv.loop_length_seconds / tv.slot_seconds))} ad slots
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Last seen {timeAgo(tv.last_heartbeat_at)}
                        </p>
                      </div>
                      <LiveStatus
                        lastHeartbeat={tv.last_heartbeat_at}
                        paired={!!tv.device_id}
                        adsRunning={adsByTv.get(tv.id) ?? 0}
                      />
                      <Link
                        href={`/admin/tvs/${tv.id}`}
                        className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        Open <ChevronRight className="size-4" />
                      </Link>
                    </div>

                    {/* Setup — pairing code / kiosk link + WiFi, same as the screen page */}
                    <div className="mt-3 space-y-2 rounded-md border border-border/60 bg-muted/30 p-3">
                      <p className="text-xs font-medium">Setup</p>
                      {tv.device_id ? (
                        <>
                          <p className="text-xs text-muted-foreground">
                            This screen is paired. To re-image a replacement Pi for the same screen,
                            program this kiosk link onto it — no re-pairing needed.
                          </p>
                          <CopyField
                            value={kioskUrl(origin, tv.device_id)}
                            label="Copy screen link"
                          />
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-muted-foreground">
                            Give the technician this pairing code, or set the kiosk URL to the setup
                            link below to pair automatically.
                          </p>
                          <div className="rounded-lg border border-border bg-background px-4 py-3 text-center">
                            <p className="font-heading text-2xl font-bold tracking-[0.25em] tabular-nums">
                              {tv.pairing_code ?? '—'}
                            </p>
                          </div>
                          {tv.pairing_code && (
                            <CopyField
                              value={pairingUrl(origin, tv.pairing_code)}
                              label="Copy setup link"
                            />
                          )}
                        </>
                      )}

                      {provisioning &&
                        (provisioning.network_type === 'ethernet' ? (
                          <p className="pt-1 text-xs text-muted-foreground">
                            Network: Wired (Ethernet)
                            {provisioning.network_note ? ` · ${provisioning.network_note}` : ''}
                          </p>
                        ) : (
                          (provisioning.wifi_ssid || provisioning.wifi_password) && (
                            <div className="space-y-1.5 pt-1">
                              <p className="text-xs font-medium text-muted-foreground">
                                WiFi to program
                              </p>
                              {provisioning.wifi_ssid && (
                                <CopyField
                                  value={provisioning.wifi_ssid}
                                  display={`SSID: ${provisioning.wifi_ssid}`}
                                  label="Copy SSID"
                                />
                              )}
                              {provisioning.wifi_password && (
                                <CopyField
                                  value={provisioning.wifi_password}
                                  display="Password: ••••••••"
                                  label="Copy password"
                                />
                              )}
                              {provisioning.network_note && (
                                <p className="text-xs text-muted-foreground">
                                  {provisioning.network_note}
                                </p>
                              )}
                            </div>
                          )
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

import { CalendarDays } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requireProfile } from '@/lib/auth'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { hasUnlimitedChanges } from '@/lib/membership'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdvertiseLink } from '@/components/app/AdvertiseLink'
import { CalendarClient, type CalendarCampaign, type ScheduledSpot } from './CalendarClient'

// The content calendar: plan a year of creative up front instead of remembering
// to swap it the week of. Read side only — every write goes through
// ./actions.ts, and the swap itself happens in the nightly cron.
export default async function ContentCalendarPage() {
  const profile = await requireProfile()
  const supabase = await createClient()

  const [{ data: campaignRows }, { data: spotRows }] = await Promise.all([
    supabase
      .from('campaigns')
      .select('id, status, ad:ads(id, title, creative_url, creative_type, qr_target_url, qr_x, qr_y, qr_size)')
      .is('deleted_at', null)
      .is('archived_at', null)
      .neq('status', 'canceled')
      .order('created_at', { ascending: false }),
    supabase
      .from('scheduled_creatives')
      .select('id, campaign_id, label, creative_url, creative_type, run_on, status, status_note, applied_at')
      .neq('status', 'canceled')
      .order('run_on', { ascending: true }),
  ])

  type Row = {
    id: string
    status: string
    ad: {
      id: string
      title: string | null
      creative_url: string | null
      creative_type: 'image' | 'video' | null
      qr_target_url: string | null
      qr_x: number | null
      qr_y: number | null
      qr_size: number | null
    } | null
  }

  const campaigns: CalendarCampaign[] = ((campaignRows ?? []) as unknown as Row[])
    // Only campaigns with an ad can take a scheduled swap.
    .filter((c) => c.ad?.id)
    .map((c) => ({
      id: c.id,
      status: c.status,
      title: c.ad?.title || 'Your ad',
      currentCreativeUrl: c.ad?.creative_url ?? null,
      currentCreativeType: c.ad?.creative_type ?? 'image',
      qrTargetUrl: c.ad?.qr_target_url ?? null,
      qrX: c.ad?.qr_x ?? null,
      qrY: c.ad?.qr_y ?? null,
      qrSize: c.ad?.qr_size ?? null,
    }))

  const spots = (spotRows ?? []) as ScheduledSpot[]

  // Members change creative for free, so their calendar never has to wait on the
  // weekly free change. Everyone else gets that explained up front rather than
  // discovering it when a spot sits an extra day.
  const isMember = await hasUnlimitedChanges(createAdminClient(), profile.id)

  if (!campaigns.length) {
    return (
      <div className="space-y-4">
        <Header />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <CalendarDays className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Once you have a campaign running, plan its spots here — a year at a time.
            </p>
            <AdvertiseLink to="/browse" className={cn(buttonVariants({ size: 'sm' }))}>
              Start a campaign
            </AdvertiseLink>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Header />
      <CalendarClient
        campaigns={campaigns}
        spots={spots}
        userId={profile.id}
        isMember={isMember}
      />
    </div>
  )
}

function Header() {
  return (
    <div>
      <h1 className="font-heading text-2xl font-extrabold tracking-tight">Content calendar</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Line up your spots for the year. Each one goes to review the night before its date, so it is
        approved and on screen when you planned it.
      </p>
    </div>
  )
}

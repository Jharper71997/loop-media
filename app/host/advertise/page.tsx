import Link from 'next/link'
import { Plus, ImageOff, MonitorPlay } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requireProfile } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type HostCampaignRow = {
  id: string
  status: string
  created_at: string
  ad: {
    title: string
    status: string
    creative_type: 'video' | 'image'
    creative_url: string | null
    rejection_reason: string | null
  } | null
  targets: { count: number }[] | null
  subscription: { status: string }[] | null
}

// Status pill mirroring the advertiser dashboard, minus any $-specific hints
// (host advertising surfaces stay dollar-free — they run on the host perk).
function statusLabel(c: HostCampaignRow): {
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success'
  hint?: string
} {
  if (c.ad?.status === 'rejected') return { label: 'Rejected', variant: 'destructive' }
  if (c.ad?.status === 'pending') return { label: 'Pending review', variant: 'secondary' }
  if (c.status === 'active') return { label: 'Active', variant: 'success' }
  if (c.status === 'paused') return { label: 'Paused', variant: 'outline' }
  if (c.status === 'canceled') return { label: 'Canceled', variant: 'destructive' }
  if (!c.ad?.creative_url)
    return { label: 'Missing creative', variant: 'outline', hint: 'Upload your ad to continue' }
  return { label: 'Draft', variant: 'secondary' }
}

// The host "Advertise" tab. Previously this just bounced into the buy flow, so a
// host had no way to see the campaigns they run on the network. Now it lists their
// own campaigns (dollar-free per host-surface convention); "New" starts a fresh
// buy, and each card opens the shared campaign detail page under /host/advertise.
export default async function HostAdvertiseDashboard() {
  const profile = await requireProfile()
  const supabase = await createClient()
  const { data } = await supabase
    .from('campaigns')
    .select(
      '*, ad:ads(title, status, creative_type, creative_url, rejection_reason), targets:campaign_targets(count), subscription:subscriptions(status)'
    )
    .eq('advertiser_id', profile.id)
    .is('deleted_at', null)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
  const campaigns = (data ?? []) as HostCampaignRow[]
  const hasCampaigns = campaigns.length > 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Your ads</h1>
          <p className="text-sm text-muted-foreground">
            Campaigns you&apos;re running across the network.
          </p>
        </div>
        {hasCampaigns && (
          <Link href="/host/advertise/browse" className={cn(buttonVariants({ size: 'sm' }))}>
            <Plus className="size-4" /> New
          </Link>
        )}
      </div>

      {!hasCampaigns ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-primary/10">
              <MonitorPlay className="size-6 text-primary" />
            </span>
            <div className="space-y-1">
              <h2 className="font-heading text-xl font-bold">Advertise on the network</h2>
              <p className="mx-auto max-w-xs text-sm text-muted-foreground">
                Put your own business on screens around town. Pick the spots on a map, upload your
                ad, and you&apos;re live.
              </p>
            </div>
            <Link href="/host/advertise/browse" className={cn(buttonVariants({ size: 'lg' }))}>
              <Plus className="size-4" /> Start a campaign
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => {
            const s = statusLabel(c)
            const screens = c.targets?.[0]?.count ?? 0
            return (
              <Link key={c.id} href={`/host/advertise/campaigns/${c.id}`}>
                <Card className="overflow-hidden transition hover:border-primary/50">
                  <div className="flex aspect-video items-center justify-center bg-black">
                    {c.ad?.creative_url ? (
                      c.ad.creative_type === 'video' ? (
                        <video
                          src={c.ad.creative_url}
                          className="h-full w-full object-contain"
                          muted
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.ad.creative_url}
                          alt={c.ad.title}
                          className="h-full w-full object-contain"
                        />
                      )
                    ) : (
                      <ImageOff className="size-6 text-muted-foreground" />
                    )}
                  </div>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{c.ad?.title ?? 'Untitled'}</span>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {screens} screen{screens === 1 ? '' : 's'}
                    </div>
                    {c.ad?.status === 'rejected' && c.ad.rejection_reason && (
                      <p className="text-xs text-destructive">Reason: {c.ad.rejection_reason}</p>
                    )}
                    {s.hint && <p className="text-xs text-warning">{s.hint}</p>}
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

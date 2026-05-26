import Link from 'next/link'
import { Plus, ImageOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requireProfile } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

type CampaignRow = {
  id: string
  target_impressions: number
  status: string
  created_at: string
  ad: {
    title: string
    status: string
    creative_type: 'video' | 'image'
    creative_url: string | null
    rejection_reason: string | null
  } | null
  package: { name: string; tier: string } | null
  subscription: { status: string }[] | null
}

function statusLabel(c: CampaignRow): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
  if (c.ad?.status === 'rejected') return { label: 'Rejected', variant: 'destructive' }
  if (c.ad?.status === 'pending') return { label: 'Pending review', variant: 'secondary' }
  if (c.status === 'active') return { label: 'Active', variant: 'default' }
  if (c.status === 'paused') return { label: 'Paused', variant: 'outline' }
  if (c.status === 'canceled') return { label: 'Canceled', variant: 'destructive' }
  return { label: 'Draft', variant: 'secondary' }
}

export default async function AdvertiserDashboard() {
  await requireProfile()
  const supabase = await createClient()
  const { data } = await supabase
    .from('campaigns')
    .select(
      '*, ad:ads(title, status, creative_type, creative_url, rejection_reason), package:packages(name, tier), subscription:subscriptions(status)'
    )
    .order('created_at', { ascending: false })
  const campaigns = (data ?? []) as CampaignRow[]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your campaigns</h1>
          <p className="text-sm text-muted-foreground">
            Reach customers on screens across town.
          </p>
        </div>
        <Link href="/advertiser/new" className={buttonVariants()}>
          <Plus className="size-4" /> New campaign
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <p className="text-muted-foreground">
              No campaigns yet. Launch your first ad in a couple of minutes.
            </p>
            <Link href="/advertiser/new" className={buttonVariants()}>
              <Plus className="size-4" /> Create a campaign
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => {
            const s = statusLabel(c)
            return (
              <Link key={c.id} href={`/advertiser/campaigns/${c.id}`}>
                <Card className="overflow-hidden transition hover:border-primary/50">
                  <div className="flex aspect-video items-center justify-center bg-black">
                    {c.ad?.creative_url ? (
                      c.ad.creative_type === 'video' ? (
                        <video src={c.ad.creative_url} className="h-full w-full object-contain" muted />
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
                      <Badge variant={s.variant} className={cn(s.label === 'Active' && 'bg-emerald-600')}>
                        {s.label}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.package?.name ?? 'Custom'} · goal {formatNumber(c.target_impressions)} impressions/mo
                    </div>
                    {c.ad?.status === 'rejected' && c.ad.rejection_reason && (
                      <p className="text-xs text-destructive">Reason: {c.ad.rejection_reason}</p>
                    )}
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

import Link from 'next/link'
import { Plus, ImageOff, Lock, Gift, Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requireProfile } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatCents } from '@/lib/format'
import { cn } from '@/lib/utils'
import { loyaltyCredits } from '@/lib/pricing'
import { resolveAdvertiserContext } from '@/lib/pricing.server'

type CampaignRow = {
  id: string
  monthly_total_cents: number | null
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

function statusLabel(c: CampaignRow): {
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
} {
  if (c.ad?.status === 'rejected') return { label: 'Rejected', variant: 'destructive' }
  if (c.ad?.status === 'pending') return { label: 'Pending review', variant: 'secondary' }
  if (c.status === 'active') return { label: 'Active', variant: 'default' }
  if (c.status === 'paused') return { label: 'Paused', variant: 'outline' }
  if (c.status === 'canceled') return { label: 'Canceled', variant: 'destructive' }
  return { label: 'Draft', variant: 'secondary' }
}

export default async function AdvertiserDashboard() {
  const profile = await requireProfile()
  const supabase = await createClient()
  const [{ data }, ctx] = await Promise.all([
    supabase
      .from('campaigns')
      .select(
        '*, ad:ads(title, status, creative_type, creative_url, rejection_reason), targets:campaign_targets(count), subscription:subscriptions(status)'
      )
      .order('created_at', { ascending: false }),
    resolveAdvertiserContext(profile.id),
  ])
  const campaigns = (data ?? []) as CampaignRow[]
  const credits = loyaltyCredits({
    monthsActive: ctx.monthsActive,
    screensRunning: ctx.screensRunning,
  })

  const perks: { icon: typeof Lock; label: string }[] = []
  if (credits.rateLocked)
    perks.push({ icon: Lock, label: 'Founding Advertiser — your rates are locked in' })
  if (credits.freeScreens > 0)
    perks.push({
      icon: Gift,
      label: `${credits.freeScreens} free screen${credits.freeScreens === 1 ? '' : 's'} on your next order`,
    })
  if (credits.loyalty12mo) perks.push({ icon: Sparkles, label: 'Loyalty bonus — extra 5% off everything' })

  // Next milestone nudge (the "I'm at 9, let me hit 10" pull).
  let nextMilestone: string | null = null
  if (ctx.screensRunning < 10)
    nextMilestone = `Reach 10 screens to unlock 2 free (${ctx.screensRunning}/10)`
  else if (ctx.monthsActive < 12)
    nextMilestone = `${12 - ctx.monthsActive} month${12 - ctx.monthsActive === 1 ? '' : 's'} to your 5% loyalty discount`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your campaigns</h1>
          <p className="text-sm text-muted-foreground">Reach customers on screens across town.</p>
        </div>
        <Link href="/advertiser/browse" className={buttonVariants()}>
          <Plus className="size-4" /> New campaign
        </Link>
      </div>

      {(perks.length > 0 || nextMilestone) && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
            {perks.map((p) => (
              <span key={p.label} className="flex items-center gap-2 text-sm font-medium">
                <p.icon className="size-4 text-primary" /> {p.label}
              </span>
            ))}
            {nextMilestone && (
              <span className="text-sm text-muted-foreground">{nextMilestone}</span>
            )}
          </CardContent>
        </Card>
      )}

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <p className="text-muted-foreground">
              No campaigns yet. Build one off the map in a couple of minutes.
            </p>
            <Link href="/advertiser/browse" className={buttonVariants()}>
              <Plus className="size-4" /> Build a campaign
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => {
            const s = statusLabel(c)
            const screens = c.targets?.[0]?.count ?? 0
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
                      {screens} screen{screens === 1 ? '' : 's'}
                      {c.monthly_total_cents != null && (
                        <> · {formatCents(c.monthly_total_cents)}/mo</>
                      )}
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

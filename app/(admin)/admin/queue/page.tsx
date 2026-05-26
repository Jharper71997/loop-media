import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { Badge } from '@/components/ui/badge'
import { ImageOff } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import type { Ad } from '@/lib/db.types'
import { ReviewButtons } from './ReviewButtons'

type QueueAd = Ad & {
  owner: { full_name: string | null; email: string } | null
  category: { name: string } | null
}

export default async function QueuePage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  let q = supabase
    .from('ads')
    .select('*, owner:profiles!owner_user_id(full_name, email), category:categories(name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (t) q = q.eq('territory_id', t)
  const { data } = await q
  const ads = (data ?? []) as QueueAd[]

  return (
    <>
      <PageHeader
        title="Approval queue"
        description={`${ads.length} ad${ads.length === 1 ? '' : 's'} awaiting review`}
      />

      <div className="p-6">
        {ads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center text-muted-foreground">
            🎉 Nothing to review. The queue is empty.
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {ads.map((ad) => (
              <div
                key={ad.id}
                className="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
              >
                <div className="relative flex aspect-video items-center justify-center bg-black">
                  {ad.creative_url ? (
                    ad.creative_type === 'video' ? (
                      <video
                        src={ad.creative_url}
                        className="h-full w-full object-contain"
                        controls
                        muted
                        playsInline
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={ad.creative_url}
                        alt={ad.title}
                        className="h-full w-full object-contain"
                      />
                    )
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-muted-foreground">
                      <ImageOff className="size-6" />
                      <span className="text-xs">No creative uploaded</span>
                    </div>
                  )}
                  <Badge className="absolute top-2 left-2 capitalize" variant="secondary">
                    {ad.creative_type}
                  </Badge>
                </div>

                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div>
                    <div className="font-medium">{ad.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {ad.owner?.full_name ?? ad.owner?.email ?? 'Unknown'} ·{' '}
                      {ad.category?.name ?? 'No category'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="capitalize">
                      {ad.owner_kind}
                    </Badge>
                    <span>{formatDateTime(ad.created_at)}</span>
                  </div>
                  {ad.qr_target_url && (
                    <div className="truncate text-xs text-muted-foreground">
                      QR → {ad.qr_target_url}
                    </div>
                  )}
                  <div className="mt-auto pt-1">
                    <ReviewButtons id={ad.id} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

import Link from 'next/link'
import { ArrowLeft, ImageOff, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requireProfile } from '@/lib/auth'
import { Card, CardContent } from '@/components/ui/card'
import { formatCents } from '@/lib/format'
import { RestoreButton } from './TrashControls'

type TrashedRow = {
  id: string
  monthly_total_cents: number | null
  deleted_at: string | null
  ad: { title: string; creative_type: 'video' | 'image'; creative_url: string | null } | null
  targets: { count: number }[] | null
}

export default async function TrashPage() {
  await requireProfile()
  const supabase = await createClient()
  const { data } = await supabase
    .from('campaigns')
    .select('id, monthly_total_cents, deleted_at, ad:ads(title, creative_type, creative_url), targets:campaign_targets(count)')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
  const rows = (data ?? []) as unknown as TrashedRow[]

  return (
    <div className="space-y-6">
      <Link
        href="/advertiser"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Your ads
      </Link>

      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Trash</h1>
        <p className="text-sm text-muted-foreground">
          Deleted campaigns are kept here. Restore one anytime to bring it back.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Trash2 className="size-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Trash is empty.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((c) => {
            const screens = c.targets?.[0]?.count ?? 0
            return (
              <Card key={c.id}>
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex aspect-video h-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black">
                    {c.ad?.creative_url ? (
                      c.ad.creative_type === 'video' ? (
                        <video src={c.ad.creative_url} className="h-full w-full object-contain" muted />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.ad.creative_url} alt={c.ad.title} loading="lazy" decoding="async" className="h-full w-full object-contain" />
                      )
                    ) : (
                      <ImageOff className="size-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.ad?.title ?? 'Untitled'}</p>
                    <p className="text-xs text-muted-foreground">
                      {screens} screen{screens === 1 ? '' : 's'}
                      {c.monthly_total_cents != null && <> · {formatCents(c.monthly_total_cents)}/mo</>}
                    </p>
                  </div>
                  <RestoreButton id={c.id} />
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

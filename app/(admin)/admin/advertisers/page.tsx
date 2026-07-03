import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { ImageOff } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Profile } from '@/lib/db.types'

// One creative row per advertiser: small thumbnails with a status dot, so admins
// see what each advertiser is running at a glance (deep view is the detail page).
type AdRow = {
  owner_user_id: string
  title: string | null
  creative_url: string | null
  creative_type: string | null
  status: string
  category_id: string | null
}

const STATUS_DOT: Record<string, string> = {
  active: 'bg-emerald-500',
  approved: 'bg-emerald-500',
  pending: 'bg-amber-500',
  paused: 'bg-slate-400',
  rejected: 'bg-red-500',
}

function AdThumbs({ ads }: { ads: AdRow[] }) {
  if (ads.length === 0)
    return <span className="text-xs text-muted-foreground">No ads yet</span>
  const shown = ads.slice(0, 5)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((ad, i) => (
        <div
          key={i}
          title={`${ad.title ?? 'Untitled'} · ${ad.status}`}
          className="relative h-10 w-16 shrink-0 overflow-hidden rounded border border-border bg-black"
        >
          {ad.creative_url ? (
            ad.creative_type === 'video' ? (
              <video src={ad.creative_url} className="h-full w-full object-contain" muted />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ad.creative_url}
                alt={ad.title ?? ''}
                className="h-full w-full object-contain"
              />
            )
          ) : (
            <div className="grid h-full w-full place-items-center">
              <ImageOff className="size-4 text-muted-foreground" />
            </div>
          )}
          <span
            className={cn(
              'absolute right-0.5 top-0.5 size-2 rounded-full ring-1 ring-black/40',
              STATUS_DOT[ad.status] ?? 'bg-slate-400'
            )}
          />
        </div>
      ))}
      {ads.length > shown.length && (
        <span className="text-xs text-muted-foreground">+{ads.length - shown.length}</span>
      )}
    </div>
  )
}

export default async function AdvertisersPage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  let q = supabase
    .from('profiles')
    .select('*')
    .eq('role', 'advertiser')
    .order('created_at', { ascending: false })
  if (t) q = q.eq('territory_id', t)
  const { data } = await q
  const advertisers = (data ?? []) as Profile[]

  const ids = advertisers.map((a) => a.id)
  const adsByOwner = new Map<string, AdRow[]>()
  if (ids.length) {
    const { data: ads } = await supabase
      .from('ads')
      .select('owner_user_id, title, creative_url, creative_type, status, category_id')
      .eq('owner_kind', 'advertiser')
      .in('owner_user_id', ids)
      .order('created_at', { ascending: false })
    for (const ad of (ads ?? []) as AdRow[]) {
      const arr = adsByOwner.get(ad.owner_user_id) ?? []
      arr.push(ad)
      adsByOwner.set(ad.owner_user_id, arr)
    }
  }
  const countsFor = (arr: AdRow[]) => ({
    total: arr.length,
    active: arr.filter((x) => x.status === 'active').length,
  })

  return (
    <>
      <PageHeader
        title="Advertisers"
        description={`${advertisers.length} advertiser${advertisers.length === 1 ? '' : 's'}`}
      />

      <div className="p-5 md:p-6">
        {/* Mobile cards */}
        <div className="space-y-2.5 md:hidden">
          {advertisers.length === 0 && (
            <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              No advertisers yet.
            </p>
          )}
          {advertisers.map((a) => {
            const ads = adsByOwner.get(a.id) ?? []
            const counts = countsFor(ads)
            return (
              <Link
                key={a.id}
                href={`/admin/advertisers/${a.id}`}
                className="block rounded-xl border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{a.full_name ?? '—'}</div>
                    <div className="truncate text-xs text-muted-foreground">{a.email}</div>
                  </div>
                  {counts.active > 0 ? (
                    <Badge>{counts.active} active</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">0 active</span>
                  )}
                </div>
                <div className="mt-2.5">
                  <AdThumbs ads={ads} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                  <span>
                    {counts.total} ad{counts.total === 1 ? '' : 's'}
                  </span>
                  <span>Joined {formatDateTime(a.created_at)}</span>
                </div>
              </Link>
            )
          })}
        </div>

        {/* Desktop table */}
        <div className="hidden rounded-lg border border-border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Advertising</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Ads</TableHead>
                <TableHead className="text-right">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {advertisers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No advertisers yet.
                  </TableCell>
                </TableRow>
              )}
              {advertisers.map((a) => {
                const ads = adsByOwner.get(a.id) ?? []
                const counts = countsFor(ads)
                return (
                  <TableRow key={a.id} className="cursor-pointer hover:bg-accent/50">
                    <TableCell className="font-medium">
                      <Link href={`/admin/advertisers/${a.id}`} className="block hover:underline">
                        {a.full_name ?? '—'}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <Link href={`/admin/advertisers/${a.id}`} className="block">
                        {a.email}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <AdThumbs ads={ads} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(a.created_at)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{counts.total}</TableCell>
                    <TableCell className="text-right">
                      {counts.active > 0 ? (
                        <Badge>{counts.active}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  )
}

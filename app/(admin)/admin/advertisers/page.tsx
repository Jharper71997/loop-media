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
import { formatDateTime } from '@/lib/format'
import type { Profile } from '@/lib/db.types'

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
  const adsByOwner = new Map<string, { total: number; active: number }>()
  if (ids.length) {
    const { data: ads } = await supabase
      .from('ads')
      .select('owner_user_id, status')
      .eq('owner_kind', 'advertiser')
      .in('owner_user_id', ids)
    for (const ad of ads ?? []) {
      const cur = adsByOwner.get(ad.owner_user_id) ?? { total: 0, active: 0 }
      cur.total += 1
      if (ad.status === 'active') cur.active += 1
      adsByOwner.set(ad.owner_user_id, cur)
    }
  }

  return (
    <>
      <PageHeader
        title="Advertisers"
        description={`${advertisers.length} advertiser${advertisers.length === 1 ? '' : 's'}`}
      />

      <div className="p-6">
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Ads</TableHead>
                <TableHead className="text-right">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {advertisers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No advertisers yet.
                  </TableCell>
                </TableRow>
              )}
              {advertisers.map((a) => {
                const counts = adsByOwner.get(a.id) ?? { total: 0, active: 0 }
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.full_name ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{a.email}</TableCell>
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

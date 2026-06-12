import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { DeleteButton } from '@/components/admin/DeleteButton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Category } from '@/lib/db.types'
import { AddCategory } from './AddCategory'
import { CapInput } from './CapInput'
import { CategoryRequests, type CategoryRequest } from './CategoryRequests'
import { deleteCategory } from './actions'

export default async function CategoriesPage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const supabase = await createClient()

  const { data: cats } = await supabase.from('categories').select('*').order('name')
  const categories = (cats ?? []) as Category[]

  // Pending "Other" requests from advertisers.
  const { data: reqData } = await supabase
    .from('category_requests')
    .select('id, proposed_name, created_at, advertiser:profiles(email, full_name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  const requests: CategoryRequest[] = (
    (reqData ?? []) as unknown as {
      id: string
      proposed_name: string
      created_at: string
      advertiser: { email: string; full_name: string | null } | null
    }[]
  ).map((r) => ({
    id: r.id,
    proposed_name: r.proposed_name,
    created_at: r.created_at,
    requested_by: r.advertiser?.full_name ?? r.advertiser?.email ?? 'someone',
  }))

  const capByCat = new Map<string, number>()
  if (t) {
    const { data: caps } = await supabase
      .from('category_caps')
      .select('category_id, max_advertisers')
      .eq('territory_id', t)
    for (const c of caps ?? []) capByCat.set(c.category_id, c.max_advertisers)
  }

  const activeName = territory.territories.find((x) => x.id === t)?.name

  return (
    <>
      <PageHeader
        title="Categories & caps"
        description={
          t
            ? `Max advertisers per category in ${activeName}`
            : 'Global category catalog'
        }
        action={<AddCategory />}
      />

      <div className="space-y-4 p-6">
        <CategoryRequests requests={requests} />

        {!t && (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            Select a single territory in the sidebar to view and edit its
            per-category advertiser caps.
          </p>
        )}

        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Slug</TableHead>
                {t && <TableHead>Max advertisers</TableHead>}
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {c.slug}
                  </TableCell>
                  {t && (
                    <TableCell>
                      <CapInput
                        territoryId={t}
                        categoryId={c.id}
                        initial={capByCat.get(c.id) ?? null}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex justify-end">
                      <DeleteButton
                        id={c.id}
                        action={deleteCategory}
                        confirmText="Delete this category? Venues/ads using it will lose their category."
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  )
}

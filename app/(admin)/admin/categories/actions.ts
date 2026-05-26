'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

export async function createCategory(name: string) {
  await requireAdmin()
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Name is required.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('categories')
    .insert({ name: trimmed, slug: slugify(trimmed) })
  if (error) return { error: error.message }
  revalidatePath('/admin/categories')
  return { error: null }
}

export async function deleteCategory(id: string) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/categories')
  return { error: null }
}

// Upsert the per-territory advertiser cap for a category.
export async function setCap(
  territoryId: string,
  categoryId: string,
  maxAdvertisers: number
) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from('category_caps')
    .upsert(
      { territory_id: territoryId, category_id: categoryId, max_advertisers: maxAdvertisers },
      { onConflict: 'territory_id,category_id' }
    )
  if (error) return { error: error.message }
  revalidatePath('/admin/categories')
  return { error: null }
}

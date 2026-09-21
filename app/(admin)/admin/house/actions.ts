'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export type HouseKind = 'brewloop' | 'advertise'

const KINDS: HouseKind[] = ['brewloop', 'advertise']

// Save an uploaded creative as the override for a house slide. The file is already
// in the public `creatives` bucket (the client uploads it under the admin's own uid
// folder, which is what the storage RLS allows) — this records the URL.
//
// One ACTIVE override per slide per scope, enforced by a partial unique index in
// 0063. Rather than let that index throw at the user, the previous active row for
// the same slot is retired first: the history stays, only one plays.
export async function setHouseCreative(input: {
  kind: HouseKind
  territoryId: string | null
  creativeType: 'image' | 'video'
  creativeUrl: string
}) {
  await requireAdmin()
  if (!KINDS.includes(input.kind)) return { error: 'Unknown house slide.' }
  if (!input.creativeUrl) return { error: 'Upload a creative first.' }

  const admin = createAdminClient()

  let retire = admin
    .from('house_creatives')
    .update({ active: false })
    .eq('kind', input.kind)
    .eq('active', true)
  retire = input.territoryId
    ? retire.eq('territory_id', input.territoryId)
    : retire.is('territory_id', null)
  const { error: retireErr } = await retire
  if (retireErr) return { error: retireErr.message }

  const { error } = await admin.from('house_creatives').insert({
    kind: input.kind,
    territory_id: input.territoryId,
    creative_type: input.creativeType,
    creative_url: input.creativeUrl,
    show_qr: false,
  })
  if (error) return { error: error.message }

  revalidatePath('/admin/house')
  return { error: null }
}

// Switch a house slide on or off for the current scope — the whole network when
// territoryId is null, or one market when it isn't (migration 0075). This is about
// whether the slide PLAYS AT ALL, which is a different question from which artwork
// it uses, so it's stored separately from the creative override: switching a slide
// off and back on doesn't disturb the upload sitting behind it.
//
// A screen can also be excluded on its own page; either level saying "off" keeps
// the slide off there. Screens pick the change up on their next ~30s poll.
export async function setHouseSlideEnabled(input: {
  kind: HouseKind
  territoryId: string | null
  enabled: boolean
}) {
  await requireAdmin()
  if (!KINDS.includes(input.kind)) return { error: 'Unknown house slide.' }

  const admin = createAdminClient()

  // One row per (slide, scope) — enforced by partial unique indexes in 0075 —
  // so this updates the existing row rather than stacking a second one. Written
  // as read-then-write instead of an upsert because the global row's NULL
  // territory_id can't be matched by an ON CONFLICT target.
  let q = admin.from('house_slide_settings').select('id').eq('kind', input.kind)
  q = input.territoryId ? q.eq('territory_id', input.territoryId) : q.is('territory_id', null)
  const { data: existing } = await q.maybeSingle()

  const { error } = existing
    ? await admin
        .from('house_slide_settings')
        .update({ enabled: input.enabled, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    : await admin.from('house_slide_settings').insert({
        kind: input.kind,
        territory_id: input.territoryId,
        enabled: input.enabled,
      })
  if (error) return { error: error.message }

  revalidatePath('/admin/house')
  return { error: null }
}

// Drop a MARKET's on/off override so that market follows the network-wide setting
// again. Only offered when a market is selected — there's nothing above the
// network-wide row to fall back to.
export async function clearHouseSlideEnabled(kind: HouseKind, territoryId: string) {
  await requireAdmin()
  if (!KINDS.includes(kind)) return { error: 'Unknown house slide.' }
  const { error } = await createAdminClient()
    .from('house_slide_settings')
    .delete()
    .eq('kind', kind)
    .eq('territory_id', territoryId)
  if (error) return { error: error.message }
  revalidatePath('/admin/house')
  return { error: null }
}

// Name an upload so the list reads "Christmas 2026" instead of four identical
// dates. Blank clears the name and the row falls back to showing its upload date.
export async function renameHouseCreative(id: string, label: string) {
  await requireAdmin()
  const trimmed = label.trim()
  if (trimmed.length > 80) return { error: 'Keep the name under 80 characters.' }
  const { error } = await createAdminClient()
    .from('house_creatives')
    .update({ label: trimmed || null })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/house')
  return { error: null }
}

// Swap the artwork on an EXISTING upload, in place. Different from uploading a new
// one: the row keeps its name and its live/paused state, so fixing a typo in a
// creative doesn't leave a near-duplicate sitting in the history. If the row is the
// one on screens, the new file is on the TVs within a minute.
export async function replaceHouseCreativeFile(input: {
  id: string
  creativeType: 'image' | 'video'
  creativeUrl: string
}) {
  await requireAdmin()
  if (!input.creativeUrl) return { error: 'Upload a creative first.' }

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('house_creatives')
    .select('creative_url')
    .eq('id', input.id)
    .maybeSingle()
  if (!row) return { error: 'That upload is gone — refresh the page.' }

  const { error } = await admin
    .from('house_creatives')
    .update({ creative_type: input.creativeType, creative_url: input.creativeUrl })
    .eq('id', input.id)
  if (error) return { error: error.message }

  // The old file is now unreferenced, so take it out of the bucket rather than
  // leaving orphans behind every edit.
  await removeStoredCreative(admin, row.creative_url)

  revalidatePath('/admin/house')
  return { error: null }
}

// Delete an upload for good — the row AND the file behind it. The built-in designed
// slide comes back on the next manifest poll (~30s), with no deploy involved, so
// the worst case is re-uploading the artwork.
export async function clearHouseCreative(id: string) {
  await requireAdmin()
  const admin = createAdminClient()

  // Read the URL before the row goes, so the file can be cleaned up after.
  const { data: row } = await admin
    .from('house_creatives')
    .select('creative_url')
    .eq('id', id)
    .maybeSingle()

  const { error } = await admin.from('house_creatives').delete().eq('id', id)
  if (error) return { error: error.message }
  if (row) await removeStoredCreative(admin, row.creative_url)

  revalidatePath('/admin/house')
  return { error: null }
}

// Delete the object a house creative URL points at, from the public `creatives`
// bucket. Best-effort on purpose: a file that's already gone, or a URL from
// somewhere else, must not turn a successful database change into an error the
// admin sees. Skips anything another house row still points at.
async function removeStoredCreative(
  admin: ReturnType<typeof createAdminClient>,
  url: string | null
) {
  if (!url) return
  const marker = '/creatives/'
  const at = url.indexOf(marker)
  if (at === -1) return
  const path = decodeURIComponent(url.slice(at + marker.length)).split('?')[0]
  if (!path) return

  const { count } = await admin
    .from('house_creatives')
    .select('id', { count: 'exact', head: true })
    .eq('creative_url', url)
  if ((count ?? 0) > 0) return

  await admin.storage.from('creatives').remove([path])
}

// Pause an override without losing it — the built-in slide plays while it's off.
export async function toggleHouseCreative(id: string, active: boolean) {
  await requireAdmin()
  const admin = createAdminClient()

  // Turning one back ON has to respect the same one-active-per-scope rule the
  // insert path does, or the partial unique index rejects it.
  if (active) {
    const { data: row } = await admin
      .from('house_creatives')
      .select('kind, territory_id')
      .eq('id', id)
      .maybeSingle()
    if (row) {
      let retire = admin
        .from('house_creatives')
        .update({ active: false })
        .eq('kind', row.kind)
        .eq('active', true)
      retire = row.territory_id
        ? retire.eq('territory_id', row.territory_id)
        : retire.is('territory_id', null)
      await retire
    }
  }

  const { error } = await admin.from('house_creatives').update({ active }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/house')
  return { error: null }
}

'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, adminCanTerritory } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
// Every export of a 'use server' module has to be an async action, so the shared
// types live in lib/houseSlides.ts and the UI imports them from there.
import { HOUSE_KINDS, type HouseKind, type HouseSetting } from '@/lib/houseSlides'

// Clear whatever is currently set for one slide in one scope, so a new setting can
// take the single active slot the partial unique indexes in 0063 allow.
//
// An upload is only DEACTIVATED — the file stays in the history below the slide so
// it can be put back with one click. A `builtin`/`off` marker has no file behind
// it and nothing to remember, so it is deleted rather than left as a dead row that
// would clutter that history forever.
async function clearScope(
  admin: ReturnType<typeof createAdminClient>,
  kind: HouseKind,
  territoryId: string | null
): Promise<string | null> {
  let drop = admin
    .from('house_creatives')
    .delete()
    .eq('kind', kind)
    .eq('active', true)
    .neq('mode', 'creative')
  drop = territoryId ? drop.eq('territory_id', territoryId) : drop.is('territory_id', null)
  const { error: dropErr } = await drop
  if (dropErr) return dropErr.message

  let retire = admin
    .from('house_creatives')
    .update({ active: false })
    .eq('kind', kind)
    .eq('active', true)
  retire = territoryId ? retire.eq('territory_id', territoryId) : retire.is('territory_id', null)
  const { error } = await retire
  return error?.message ?? null
}

// A city admin can set their own market; only a global admin touches the
// network-wide default or another market. The actions here use the service-role
// client, which bypasses the RLS backstop, so the check has to be made explicitly.
async function guard(territoryId: string | null) {
  const profile = await requireAdmin()
  if (!adminCanTerritory(profile, territoryId)) {
    return territoryId
      ? 'That market is outside your access.'
      : 'Only a global admin can change the network-wide default.'
  }
  return null
}

// Save an uploaded creative as the override for a house slide. The file is already
// in the public `creatives` bucket (the client uploads it under the admin's own uid
// folder, which is what the storage RLS allows) — this records the URL.
//
// One ACTIVE row per slide per scope, enforced by a partial unique index in 0063.
// Rather than let that index throw at the user, whatever the scope had is cleared
// first: the history stays, only one plays. Uploading into a scope that was switched
// off turns the slide back on there — the upload is what plays.
export async function setHouseCreative(input: {
  kind: HouseKind
  territoryId: string | null
  creativeType: 'image' | 'video'
  creativeUrl: string
}) {
  const denied = await guard(input.territoryId)
  if (denied) return { error: denied }
  if (!HOUSE_KINDS.includes(input.kind)) return { error: 'Unknown house slide.' }
  if (!input.creativeUrl) return { error: 'Upload a creative first.' }

  const admin = createAdminClient()
  const cleared = await clearScope(admin, input.kind, input.territoryId)
  if (cleared) return { error: cleared }

  const { error } = await admin.from('house_creatives').insert({
    kind: input.kind,
    territory_id: input.territoryId,
    mode: 'creative',
    creative_type: input.creativeType,
    creative_url: input.creativeUrl,
    show_qr: false,
  })
  if (error) return { error: error.message }

  revalidatePath('/admin/house')
  return { error: null }
}

// Set where a slide plays, without touching a file: follow the network default,
// force the built-in design, or take the slide out of the loop for this scope.
// `off` on the network row stops it everywhere; a market row then overrides it,
// which is how "off everywhere except Jacksonville" is expressed.
export async function setHouseSetting(input: {
  kind: HouseKind
  territoryId: string | null
  setting: HouseSetting
}) {
  const denied = await guard(input.territoryId)
  if (denied) return { error: denied }
  if (!HOUSE_KINDS.includes(input.kind)) return { error: 'Unknown house slide.' }

  const admin = createAdminClient()
  const cleared = await clearScope(admin, input.kind, input.territoryId)
  if (cleared) return { error: cleared }

  // `default` IS the cleared state — a scope with no row follows the one above it.
  if (input.setting !== 'default') {
    const { error } = await admin.from('house_creatives').insert({
      kind: input.kind,
      territory_id: input.territoryId,
      mode: input.setting,
      show_qr: false,
    })
    if (error) return { error: error.message }
  }

  revalidatePath('/admin/house')
  revalidatePath('/admin/venues')
  return { error: null }
}

// Drop an override. The built-in designed slide comes back on the next manifest
// poll (~30s), with no deploy involved.
export async function clearHouseCreative(id: string) {
  const admin = createAdminClient()
  const { data: row } = await admin
    .from('house_creatives')
    .select('territory_id')
    .eq('id', id)
    .maybeSingle()
  const denied = await guard((row as { territory_id: string | null } | null)?.territory_id ?? null)
  if (denied) return { error: denied }

  const { error } = await admin.from('house_creatives').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/house')
  return { error: null }
}

// Pause an override without losing it — the built-in slide plays while it's off.
export async function toggleHouseCreative(id: string, active: boolean) {
  const admin = createAdminClient()
  const { data: row } = (await admin
    .from('house_creatives')
    .select('kind, territory_id')
    .eq('id', id)
    .maybeSingle()) as { data: { kind: HouseKind; territory_id: string | null } | null }
  const denied = await guard(row?.territory_id ?? null)
  if (denied) return { error: denied }

  // Turning one back ON has to respect the same one-active-per-scope rule the
  // insert path does, or the partial unique index rejects it.
  if (active && row) {
    const cleared = await clearScope(admin, row.kind, row.territory_id)
    if (cleared) return { error: cleared }
  }

  const { error } = await admin.from('house_creatives').update({ active }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/house')
  return { error: null }
}

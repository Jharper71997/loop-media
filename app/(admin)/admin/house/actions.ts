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
  showQr: boolean
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
    show_qr: input.showQr,
  })
  if (error) return { error: error.message }

  revalidatePath('/admin/house')
  return { error: null }
}

// Drop an override. The built-in designed slide comes back on the next manifest
// poll (~30s), with no deploy involved.
export async function clearHouseCreative(id: string) {
  await requireAdmin()
  const { error } = await createAdminClient().from('house_creatives').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/house')
  return { error: null }
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

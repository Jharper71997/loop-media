'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'

// Human-friendly pairing code, e.g. "LM-K7P2Q" (no ambiguous 0/O/1/I).
function genPairingCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return `LM-${s}`
}

export async function createTv(input: {
  venue_id: string
  loop_length_seconds: number
  slot_seconds: number
}) {
  await requireAdmin()
  const supabase = await createClient()

  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await supabase.from('tvs').insert({
      venue_id: input.venue_id,
      pairing_code: genPairingCode(),
      status: 'unpaired',
      loop_length_seconds: input.loop_length_seconds,
      slot_seconds: input.slot_seconds,
    })
    if (!error) {
      revalidatePath('/admin/tvs')
      return { error: null }
    }
    if (!/duplicate|unique/i.test(error.message)) return { error: error.message }
  }
  return { error: 'Could not generate a unique pairing code. Try again.' }
}

// Reset a TV so it can be paired with a fresh device: new code, clear device.
export async function regeneratePairingCode(id: string) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from('tvs')
    .update({ pairing_code: genPairingCode(), device_id: null, status: 'unpaired' })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/tvs')
  return { error: null }
}

export async function deleteTv(id: string) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase.from('tvs').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/tvs')
  return { error: null }
}

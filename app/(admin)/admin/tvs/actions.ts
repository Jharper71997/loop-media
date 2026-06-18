'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'
import { genDeviceId } from '@/lib/tv'

export async function createTv(input: {
  venue_id: string
  loop_length_seconds: number
  slot_seconds: number
}) {
  await requireAdmin()
  const supabase = await createClient()

  // The screen is born already identified: we program the Pi with this device's
  // kiosk URL before shipping it, so there's no pairing step. It comes up
  // "offline" until its first heartbeat, then flips to live on its own.
  const { error } = await supabase.from('tvs').insert({
    venue_id: input.venue_id,
    device_id: genDeviceId(),
    status: 'offline',
    loop_length_seconds: input.loop_length_seconds,
    slot_seconds: input.slot_seconds,
  })
  if (error) return { error: error.message }
  revalidatePath('/admin/tvs')
  return { error: null }
}

// Re-provision a screen: issue a fresh device identity (so the old Pi/URL stops
// counting) and clear its history. Copy the new kiosk URL onto the replacement
// Pi. Also clears any legacy pairing code.
export async function resetDevice(id: string) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from('tvs')
    .update({
      device_id: genDeviceId(),
      pairing_code: null,
      status: 'offline',
      last_heartbeat_at: null,
      last_sync_at: null,
    })
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

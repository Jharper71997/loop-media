'use server'

import { revalidatePath } from 'next/cache'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { genPairingCode, DEFAULT_LOOP_SECONDS, DEFAULT_SLOT_SECONDS } from '@/lib/tv'

// A host adds another screen to one of THEIR venues. Generates a pairing code
// the host enters on the TV at /tv. `tvs` is admin-write under RLS, so the
// insert runs with the service role — gated by an ownership check first.
export async function addScreen(venueId: string) {
  const profile = await requireProfile()

  // Verify the venue belongs to this host (admins may add to any venue).
  const supabase = await createClient()
  const { data: venue } = await supabase
    .from('venues')
    .select('id, host_user_id')
    .eq('id', venueId)
    .maybeSingle()
  if (!venue) return { error: 'Venue not found.' }
  if (profile.role !== 'admin' && venue.host_user_id !== profile.id) {
    return { error: 'That venue is not on your account.' }
  }

  const admin = createAdminClient()
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await admin.from('tvs').insert({
      venue_id: venueId,
      pairing_code: genPairingCode(),
      status: 'unpaired',
      loop_length_seconds: DEFAULT_LOOP_SECONDS,
      slot_seconds: DEFAULT_SLOT_SECONDS,
    })
    if (!error) {
      revalidatePath('/host')
      return { error: null as string | null }
    }
    if (!/duplicate|unique/i.test(error.message)) return { error: error.message }
  }
  return { error: 'Could not generate a unique pairing code. Try again.' }
}

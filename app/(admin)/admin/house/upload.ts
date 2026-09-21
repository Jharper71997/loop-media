import { createClient } from '@/lib/supabase/client'
import { validateCreativeFile } from '@/lib/adCreative'
import type { HouseKind } from './actions'

// Put a house-slide creative in the bucket and hand back what the server actions
// need. Shared by "Upload replacement" (a new entry) and "Replace file" (swapping
// the artwork on an existing one) so both go through the same validation and the
// same uid-scoped path the `creatives` storage policy requires.
//
// Browser-side upload with only the resulting URL going to the server — the same
// split the advertiser upload flow uses.
export async function uploadHouseCreative(
  file: File,
  userId: string,
  kind: HouseKind
): Promise<{ url: string; creativeType: 'image' | 'video' }> {
  const err = validateCreativeFile(file)
  if (err) throw new Error(err)

  const supabase = createClient()
  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
  // Uid folder is required by the storage policy; the timestamp keeps a re-upload
  // from colliding with a cached copy of the previous file at the same URL.
  const path = `${userId}/house-${kind}-${Date.now()}.${ext}`
  const { error: upErr } = await supabase.storage
    .from('creatives')
    .upload(path, file, { contentType: file.type, upsert: true })
  if (upErr) throw new Error(upErr.message)

  return {
    url: supabase.storage.from('creatives').getPublicUrl(path).data.publicUrl,
    creativeType: file.type.startsWith('video/') ? 'video' : 'image',
  }
}

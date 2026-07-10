'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, isGlobalAdmin } from '@/lib/auth'
import { EMAIL_CATALOG, type EmailKey } from '@/lib/emailSettings'

const KEYS = new Set<string>(EMAIL_CATALOG.map((e) => e.key))

// Empty / whitespace-only override => NULL = "use the code default".
function norm(s: string | undefined): string | null {
  const t = (s ?? '').trim()
  return t.length ? t : null
}

export async function saveEmailSetting(input: {
  key: EmailKey
  enabled: boolean
  subject: string
  heading: string
  body: string
}) {
  // Email copy is network-wide, so match the pricing rule: only a global
  // (Holdings) admin may change it, not a city-scoped admin.
  const profile = await requireAdmin()
  if (!isGlobalAdmin(profile)) {
    return { error: 'Only a network (Holdings) admin can change email settings.' }
  }
  if (!KEYS.has(input.key)) return { error: 'Unknown email.' }

  const supabase = await createClient()
  const { error } = await supabase.from('email_settings').upsert(
    {
      key: input.key,
      enabled: input.enabled,
      subject: norm(input.subject),
      heading: norm(input.heading),
      body: norm(input.body),
      updated_at: new Date().toISOString(),
      updated_by: profile.id,
    },
    { onConflict: 'key' }
  )
  if (error) return { error: error.message }

  revalidatePath('/admin/email')
  return { error: null }
}

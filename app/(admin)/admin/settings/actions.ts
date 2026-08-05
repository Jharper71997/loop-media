'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { SETTINGS, DEFAULT_SETTINGS, parseSettingInput, type SettingKey } from '@/lib/settings'

// Writing a business setting.
//
// The value arrives as the raw string someone typed ("$99", "99.00", "99") and
// is parsed and bounds-checked HERE, not just in the browser — the client-side
// check is for the error message, this one is the actual gate.

const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205'])

// Every surface that renders a setting. Cheap, and it means a price change is
// visible everywhere the moment it is saved rather than on the next deploy.
function revalidateAll() {
  for (const p of [
    '/admin',
    '/admin/settings',
    '/admin/money',
    '/admin/sell',
    '/admin/reports',
    '/admin/pricing',
    '/admin/uptime',
    '/dashboard',
  ]) {
    revalidatePath(p)
  }
}

export async function saveSetting(
  key: string,
  raw: string
): Promise<{ error: string | null; value?: number | string }> {
  await requireAdmin()

  if (!(key in SETTINGS)) return { error: 'Unknown setting' }
  const k = key as SettingKey

  const parsed = parseSettingInput(k, raw)
  if (!parsed.ok) return { error: parsed.error }

  const admin = createAdminClient()
  const { error } = await admin
    .from('app_settings')
    .upsert({ key: k, value: parsed.value, updated_at: new Date().toISOString() }, { onConflict: 'key' })

  if (error) {
    if (MISSING_TABLE_CODES.has(error.code)) {
      return {
        error:
          'Settings table not created yet. Run migration 0067 in the Supabase SQL editor, then try again.',
      }
    }
    return { error: error.message }
  }

  revalidateAll()
  return { error: null, value: parsed.value }
}

// Drop the override so the setting falls back to its coded default. Deleting the
// row rather than writing the default back means the default stays a single
// source of truth — change it in code later and this setting follows.
export async function resetSetting(key: string): Promise<{ error: string | null; value?: number | string }> {
  await requireAdmin()
  if (!(key in SETTINGS)) return { error: 'Unknown setting' }
  const k = key as SettingKey

  const admin = createAdminClient()
  const { error } = await admin.from('app_settings').delete().eq('key', k)
  if (error && !MISSING_TABLE_CODES.has(error.code)) return { error: error.message }

  revalidateAll()
  return { error: null, value: DEFAULT_SETTINGS[k] }
}

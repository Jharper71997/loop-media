// Server-side reader for the editable-settings registry.
//
// Mirrors the shape of getPricingConfig(): read the DB, fall back to the
// in-code defaults if the row or the whole table is missing, and never throw.
// The difference is that a missing app_settings table is EXPECTED until the
// migration is applied, so that case warns once per process instead of once per
// request — the app is fully functional on defaults in the meantime.
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import {
  DEFAULT_SETTINGS,
  SETTINGS,
  type SettingKey,
  type Settings,
} from '@/lib/settings'

// Postgres "undefined_table", and PostgREST's schema-cache equivalent.
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205'])

let warnedMissing = false

export const getSettings = cache(async (): Promise<Settings> => {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from('app_settings').select('key, value')

    if (error) {
      if (MISSING_TABLE_CODES.has(error.code)) {
        if (!warnedMissing) {
          warnedMissing = true
          console.warn(
            '[settings] app_settings table not found — running on in-code defaults. Apply migration 0067 to make these editable.'
          )
        }
      } else {
        console.error('[settings] failed to read app_settings — using defaults:', error)
      }
      return DEFAULT_SETTINGS
    }

    const rows = (data ?? []) as { key: string; value: unknown }[]
    const out = { ...DEFAULT_SETTINGS }
    for (const row of rows) {
      // Ignore any key that is not in the registry — a leftover row from a
      // setting that has since been removed must not leak into the object.
      if (!(row.key in SETTINGS)) continue
      const key = row.key as SettingKey
      const expected = typeof DEFAULT_SETTINGS[key]
      if (typeof row.value !== expected) {
        console.error(
          `[settings] ${row.key} stored as ${typeof row.value}, expected ${expected} — using default`
        )
        continue
      }
      // Safe: the typeof check above proves the row matches this key's type.
      ;(out as Record<string, number | string>)[key] = row.value as number | string
    }
    return out
  } catch (err) {
    console.error('[settings] failed to read app_settings — using defaults:', err)
    return DEFAULT_SETTINGS
  }
})

// Convenience for the common case of needing exactly one number.
export async function getSetting<K extends SettingKey>(key: K): Promise<Settings[K]> {
  const all = await getSettings()
  return all[key]
}

// Whether the store is actually there, and which keys are overridden — the
// settings page needs to distinguish "this is the default" from "someone set
// this to the same number as the default", and to tell you the table is missing
// instead of silently accepting edits that cannot be saved.
export const getSettingsMeta = cache(
  async (): Promise<{ ready: boolean; overridden: Set<string> }> => {
    try {
      const supabase = await createClient()
      const { data, error } = await supabase.from('app_settings').select('key')
      if (error) return { ready: false, overridden: new Set() }
      return {
        ready: true,
        overridden: new Set((data ?? []).map((r) => (r as { key: string }).key)),
      }
    } catch {
      return { ready: false, overridden: new Set() }
    }
  }
)

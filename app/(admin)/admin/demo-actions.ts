'use server'

import { requireAdmin } from '@/lib/auth'
import { cleanupStaleDemo } from '@/lib/demo'

// Purge ALL demo accounts and their data (age 0 = everything). Admin-only.
export async function resetDemo(): Promise<{ removed: number } | { error: string }> {
  await requireAdmin()
  const { removed } = await cleanupStaleDemo(0)
  return { removed }
}

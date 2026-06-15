'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { TERRITORY_COOKIE } from '@/lib/territory'

// Persist a global admin's selected territory ("all" == every territory).
export async function setActiveTerritory(value: string) {
  await requireAdmin()
  const cookieStore = await cookies()
  cookieStore.set(TERRITORY_COOKIE, value, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  revalidatePath('/admin', 'layout')
}

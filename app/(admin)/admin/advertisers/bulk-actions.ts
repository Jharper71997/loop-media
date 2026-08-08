'use server'

import { deactivateAdvertiser, reactivateAdvertiser } from './[id]/actions'

// Bulk wrappers over the single-record actions.
//
// They are thin on purpose: the per-advertiser action already does the auth
// check, the Stripe/placement cascade and the revalidate, so doing them one at a
// time is both correct and safe to interrupt. At this size (tens of accounts,
// never thousands) the sequential round trips cost less than the risk of a
// bespoke batch path drifting from the single-record one.
//
// Partial failure reports honestly rather than rolling back: the accounts that
// succeeded really did change, and pretending otherwise would leave the admin
// showing a state the database does not have.
async function each(
  ids: string[],
  // The single-record actions are not consistent about `null` vs `undefined` for
  // "no error", so accept either rather than making every caller normalise.
  run: (id: string) => Promise<{ error?: string | null }>
): Promise<{ error: string | null }> {
  const failures: string[] = []
  for (const id of ids) {
    try {
      const res = await run(id)
      if (res?.error) failures.push(res.error)
    } catch (e) {
      failures.push(e instanceof Error ? e.message : 'Unknown error')
    }
  }
  if (!failures.length) return { error: null }
  const done = ids.length - failures.length
  return {
    error: `${done} of ${ids.length} updated. ${failures.length} failed: ${failures[0]}`,
  }
}

export async function bulkDeactivateAdvertisers(ids: string[]) {
  return each(ids, deactivateAdvertiser)
}

export async function bulkReactivateAdvertisers(ids: string[]) {
  return each(ids, reactivateAdvertiser)
}

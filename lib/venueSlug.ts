import { slugify } from '@/lib/territory'

// URL slugs for venue pages, derived from the venue NAME rather than stored in a
// column.
//
// WHY NOT A slug COLUMN: it would need a migration, a backfill, and an admin
// field to edit, all to serve eleven rows that change a few times a year. The
// name is already unique in practice and already the thing a person searches
// for. If venues ever number in the hundreds, or a host renames often enough
// that link rot matters, promote this to a real column with a redirect table.
//
// TRADE-OFF, stated plainly: renaming a venue changes its URL and drops whatever
// ranking the old one earned. That is the cost of not having a migration.

// Apostrophes are DROPPED before slugifying, not treated as separators. The
// shared slugify() turns every non-alphanumeric run into a dash, which renders
// "Dragon's Breath" as `dragon-s-breath` — a stray one-letter segment that reads
// as a typo in a URL people are meant to click. Fixing it here rather than in
// lib/territory.ts, because that function also dedupes existing territory rows
// and changing its output would silently re-key them.
function venueSlugBase(name: string): string {
  return slugify(name.replace(/['’]/g, ''))
}

/**
 * Map of venue id → slug for a whole set, so collisions can be resolved.
 *
 * Two venues that slugify identically (a chain with two locations, say) both get
 * their id's first six characters appended — including the first one, because
 * silently letting whichever row sorted first keep the clean URL means the
 * mapping changes the day a row is added. Deterministic beats pretty here.
 */
export function venueSlugMap(venues: { id: string; name: string }[]): Map<string, string> {
  const counts = new Map<string, number>()
  for (const v of venues) {
    const base = venueSlugBase(v.name)
    counts.set(base, (counts.get(base) ?? 0) + 1)
  }

  const out = new Map<string, string>()
  for (const v of venues) {
    const base = venueSlugBase(v.name)
    out.set(v.id, (counts.get(base) ?? 0) > 1 ? `${base}-${v.id.slice(0, 6)}` : base)
  }
  return out
}

/** The reverse lookup: which venue does this URL slug refer to? */
export function findVenueBySlug<T extends { id: string; name: string }>(
  venues: T[],
  slug: string
): T | null {
  const map = venueSlugMap(venues)
  return venues.find((v) => map.get(v.id) === slug) ?? null
}

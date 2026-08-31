// House slides — the two spots Loop Network runs for itself between paid ads: the
// Jville Brew Loop cross-promo and the "Advertise on this screen" card.
//
// What a screen does with each one is decided here, in one function, because four
// surfaces have to agree about it: the TV manifest (app/api/tv/loop), the admin
// house page, the screen page's loop breakdown, and the venues list's slot math.
// A market that turned the Brew Loop slide off has one fewer slide in its loop,
// and every one of those surfaces has to say so.
//
// Pure and client-safe (no imports): the caller runs the query, this resolves the
// rows. See migrations 0063 (the table) and 0075 (the mode column).

export type HouseKind = 'brewloop' | 'advertise'
export const HOUSE_KINDS: HouseKind[] = ['brewloop', 'advertise']

// What a row does for the scope it names.
//   creative — play the uploaded file
//   builtin  — play the design the player draws itself
//   off      — leave the slide out of the loop entirely
export type HouseMode = 'creative' | 'builtin' | 'off'

// What one scope says about a slide in the admin UI. `default` is the absence of a
// row: for a market that means "follow the network default", and for the
// network-wide row it means "play the built-in design".
export type HouseSetting = 'default' | 'builtin' | 'off'

export type HouseRow = {
  id: string
  kind: HouseKind
  mode: HouseMode
  creative_type: 'image' | 'video' | null
  creative_url: string | null
  territory_id: string | null
}

// Every caller selects the same columns, so the shape can't drift between them.
export const HOUSE_SELECT = 'id, kind, mode, creative_type, creative_url, territory_id'

// The row set for one slide in ONE exact scope — a market, or the network-wide
// default (territoryId null). Null when that scope has said nothing.
// Callers pass only ACTIVE rows (`.eq('active', true)`), which the partial unique
// indexes in 0063 hold to at most one per scope.
// Generic over the row so a caller that selected extra columns (the admin page
// wants created_at) gets its own row type back, not a narrowed one.
export function houseRowFor<T extends HouseRow>(
  rows: T[],
  kind: HouseKind,
  territoryId: string | null
): T | null {
  return rows.find((r) => r.kind === kind && r.territory_id === territoryId) ?? null
}

// The row that actually decides a slide on a screen in this market: the market's
// own row wins, then the network-wide one. Neither = the built-in design plays.
export function resolveHouse<T extends HouseRow>(
  rows: T[],
  kind: HouseKind,
  territoryId: string | null
): T | null {
  const own = territoryId ? houseRowFor(rows, kind, territoryId) : null
  return own ?? houseRowFor(rows, kind, null)
}

// Is this slide in the loop at all on a screen in this market? Only an explicit
// `off` takes it out, so a market that has never been touched keeps playing it.
export function housePlays(
  rows: HouseRow[],
  kind: HouseKind,
  territoryId: string | null
): boolean {
  return resolveHouse(rows, kind, territoryId)?.mode !== 'off'
}

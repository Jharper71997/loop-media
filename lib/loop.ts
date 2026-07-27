// Loop capacity math — the ONE place that turns a screen's stored loop config into
// the numbers every surface shows: the admin screen page, the admin venues list,
// the advertiser browse availability, the placement engine, and the admin loop
// editor's live preview. Pure + client-safe (NO node imports) so the editor can
// recompute the breakdown as you type.
//
// The model: a screen sells `adSlots` paid spots (its loop_length ÷ slot_seconds).
// On TOP of those, the player always injects the Loop Network HOUSE slides. Those
// house slides occupy real time in the loop, so availability is presented as
// "sold + house of adSlots + house" — house counts as filled — while the number an
// advertiser can actually BUY stays `adSlots − sold` (house never eats a paid spot,
// so a screen is never un-sellable just because of house slides).

// Paid ad capacity of a screen from its stored loop config. This is what the
// placement engine fills and what an advertiser buys against.
export function adSlotCount(loopLengthSeconds: number, slotSeconds: number): number {
  return Math.max(1, Math.floor((loopLengthSeconds || 360) / (slotSeconds || 15)))
}

// The always-on Loop Network house slides every screen injects on top of paid ads:
// the Brew Loop ad + the "advertise on this screen" card (always, = 2) and the
// trivia teaser where trivia is on (+1). Keep in sync with buildPlaylist() in
// app/tv/TvPlayer.tsx and the house-slide assembly in app/api/tv/loop/route.ts.
export function houseSlideCount(opts: { triviaEnabled?: boolean | null }): number {
  return 2 + (opts.triviaEnabled ? 1 : 0)
}

// The occupancy a screen shows everywhere, with house slides counted as filled.
// `total` and `used` include the house slides; `open` is the sellable remainder.
export function loopOccupancy(opts: {
  adSlots: number
  houseSlides: number
  paidSold: number
}): { total: number; used: number; open: number; sellable: number } {
  const sellable = Math.max(0, opts.adSlots)
  const house = Math.max(0, opts.houseSlides)
  const sold = Math.max(0, opts.paidSold)
  return {
    total: sellable + house,
    used: Math.min(sold, sellable) + house,
    open: Math.max(0, sellable - sold),
    sellable,
  }
}

// m:ss for the loop-length preview.
export function formatLoopSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}m ${r}s` : `${r}s`
}

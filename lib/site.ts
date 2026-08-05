// Canonical identity for the public site: the one place the production origin,
// the brand descriptors, and the search-facing boilerplate are written down.
//
// WHY A CONSTANT AND NOT NEXT_PUBLIC_APP_URL: that env var moves. It points at a
// preview origin on preview deploys and at localhost in dev, which is exactly
// what checkout and QR links want (they must send a user back to the deployment
// they came from). Canonical URLs want the opposite — every copy of a page, on
// every origin, must name the SAME production URL or Google treats previews as
// duplicate content and splits the ranking signal between them.
// MUST be the www host. The bare apex 308-redirects to www, so a canonical tag,
// sitemap entry, or OG url naming the apex points every crawler at a redirect
// rather than at the page that actually serves the content — which is the exact
// signal dilution a canonical tag exists to prevent. Verified with:
//   curl -s -o /dev/null -w '%{http_code} %{redirect_url}' https://loopnetwork.org/
// If the apex is ever made to serve directly, change this and nothing else.
export const SITE_URL = 'https://www.loopnetwork.org'

export const SITE_NAME = 'Loop Network'

// The market, spelled the way people search for it. Jacksonville alone is
// ambiguous (Florida outranks North Carolina on every query), so the state
// abbreviation is not optional in title tags.
export const SITE_CITY = 'Jacksonville'
export const SITE_STATE = 'NC'
export const SITE_REGION = `${SITE_CITY}, ${SITE_STATE}`

// The registered address, used for LocalBusiness structured data.
export const SITE_ADDRESS = {
  street: '461 Highway 172',
  city: 'Hubert',
  state: 'NC',
  postalCode: '28539',
  country: 'US',
} as const

// One sentence, under 160 characters, that names the product AND the market.
// Google truncates past ~160 and a description that never says "Jacksonville"
// can't match a local query no matter how well the page reads.
export const SITE_DESCRIPTION =
  `Put your ad on TVs in the busiest bars, gyms, and shops around ${SITE_REGION}. ` +
  `Pick your screens, see proof of every play, from $40 a location a month.`

/** Absolute URL for a path — required for canonical tags and sitemap entries. */
export function absoluteUrl(path = '/'): string {
  return new URL(path, SITE_URL).toString()
}

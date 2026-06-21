// A venue is shown to advertisers once it has a map location (lat/lng) so we can
// place its dot. Foot traffic / impressions are NOT required — a venue can go
// live with zero impressions; we simply don't surface an impressions figure for
// it. (Until coords are set it's "incomplete": visible to admins to fill in.)
export function isVenueListable(v: {
  lat: number | null
  lng: number | null
}): boolean {
  return v.lat != null && v.lng != null
}

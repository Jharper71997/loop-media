// A venue is only shown to advertisers once it has the real data that makes it
// legitimate inventory: known foot traffic (drives impressions + price) and a
// map location. Until then it's "incomplete" — visible to admins to fill in, but
// hidden from advertisers so we never publish made-up numbers like "0 visits/mo".
export function isVenueListable(v: {
  foot_traffic_estimate: number
  lat: number | null
  lng: number | null
}): boolean {
  return v.foot_traffic_estimate > 0 && v.lat != null && v.lng != null
}

// Hand-written types mirroring the SQL schema (supabase/migrations/0001_init.sql).
// Once a Supabase project exists you can regenerate richer types with:
//   npx supabase gen types typescript --project-id <id> > lib/database.types.ts

export type UserRole = 'admin' | 'advertiser' | 'host'
export type TerritoryStatus = 'active' | 'inactive'
export type VenueStatus = 'active' | 'inactive'
export type TvStatus = 'unpaired' | 'online' | 'offline'
export type AdOwnerKind = 'advertiser' | 'host'
export type CreativeType = 'video' | 'image'
export type AdStatus = 'pending' | 'approved' | 'rejected' | 'paused' | 'active'
export type CreativeRequestStatus = 'open' | 'in_progress' | 'done'
export type PackageTier = 'bronze' | 'silver' | 'gold' | 'custom'
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'canceled'
export type SubscriptionStatus =
  | 'active'
  | 'paused'
  | 'canceled'
  | 'past_due'
  | 'incomplete'
export type PlacementStatus = 'active' | 'paused' | 'ended'
export type FillerType = 'weather' | 'sports' | 'trivia' | 'event' | 'promo'
export type PriceTier = 'local' | 'standard' | 'high' | 'premium'

export interface Territory {
  id: string
  name: string
  slug: string
  parent_id: string | null
  is_holding: boolean
  timezone: string
  status: TerritoryStatus
  created_at: string
}

export interface Profile {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  role: UserRole
  territory_id: string | null
  // The advertiser's own line of business, captured once (browse Step 1) and
  // reused so we never re-ask on later campaigns. Null for hosts/admins.
  category_id: string | null
  created_at: string
}

export interface Category {
  id: string
  name: string
  slug: string
  created_at: string
}

export interface CategoryCap {
  id: string
  territory_id: string
  category_id: string
  max_advertisers: number
  created_at: string
}

export interface Venue {
  id: string
  territory_id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  lat: number | null
  lng: number | null
  venue_type: string | null
  category_id: string | null
  foot_traffic_estimate: number
  price_tier: PriceTier | null
  price_cents_override: number | null
  exclusivity_price_cents: number | null
  category_slots: number
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  host_user_id: string | null
  status: VenueStatus
  business_open: string | null
  business_close: string | null
  business_days: number[] | null
  trivia_enabled: boolean
  median_daily_customers: number | null
  comp_promo_code: string | null
  agreement_signed_at: string | null
  agreement_signer_name: string | null
  agreement_version: string | null
  created_at: string
  updated_at: string
}

export interface Tv {
  id: string
  venue_id: string
  device_id: string | null
  pairing_code: string | null
  status: TvStatus
  loop_length_seconds: number
  slot_seconds: number
  // Per-screen house-slide durations (null = player default). See migration 0050.
  brewloop_seconds: number | null
  advertise_seconds: number | null
  trivia_slide_seconds: number | null
  filler_seconds: number | null
  last_sync_at: string | null
  last_heartbeat_at: string | null
  created_at: string
  updated_at: string
}

// Which corner the scan QR sits in on an ad creative (TV overlay + preview).
export type QrPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface Ad {
  id: string
  owner_user_id: string
  owner_kind: AdOwnerKind
  territory_id: string
  category_id: string | null
  host_venue_id: string | null
  title: string
  creative_type: CreativeType
  creative_url: string | null
  duration_seconds: number
  status: AdStatus
  rejection_reason: string | null
  qr_target_url: string | null
  qr_code_url: string | null
  qr_position: QrPosition // legacy 4-corner enum; kept for back-compat, no longer rendered
  // Free-drag QR center as fractions [0,1] of the 16:9 frame; the overlay
  // renders at left = qr_x*100%, top = qr_y*100% with translate(-50%,-50%).
  qr_x: number
  qr_y: number
  // QR width as a fraction of the frame width (null = QR_SIZE_DEFAULT).
  qr_size: number | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export interface Package {
  id: string
  tier: PackageTier
  name: string
  screen_cap: number | null
  target_impressions: number
  base_price_cents: number
  stripe_price_id: string | null
  territory_id: string | null
  active: boolean
  created_at: string
}

export interface Campaign {
  id: string
  advertiser_id: string
  ad_id: string | null
  package_id: string | null
  territory_id: string
  target_impressions: number
  screen_cap_override: number | null
  monthly_total_cents: number | null
  status: CampaignStatus
  deleted_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface Subscription {
  id: string
  advertiser_id: string
  campaign_id: string | null
  package_id: string | null
  territory_id: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  status: SubscriptionStatus
  current_period_end: string | null
  created_at: string
  updated_at: string
}

export interface CampaignTarget {
  campaign_id: string
  venue_id: string
  created_at: string
}

export interface VenueWaitlist {
  id: string
  venue_id: string
  category_id: string | null
  advertiser_id: string
  notified_at: string | null
  created_at: string
}

export interface AdPlacement {
  id: string
  ad_id: string
  tv_id: string
  campaign_id: string | null
  slot_position: number
  start_date: string
  end_date: string | null
  status: PlacementStatus
  created_at: string
}

export interface QrScan {
  id: string
  ad_id: string
  tv_id: string | null
  scanned_at: string
  user_agent: string | null
  ip_hash: string | null
  referrer: string | null
}

export interface FillerContent {
  id: string
  territory_id: string
  type: FillerType
  payload: Record<string, unknown>
  active: boolean
  expires_at: string | null
  created_at: string
}

// Creative-help pricing (client-safe constants — no server imports).
// Charged only when an advertiser chooses "Request creative help" (uploading
// their own creative stays free). One-time setup hits the first invoice; the
// refresh recurs monthly alongside the plan.
export const CREATIVE_SETUP_FEE_CENTS = 9900 // $99 one-time
export const CREATIVE_REFRESH_CENTS = 2000 // $20 / month

// Ad-change policy (Susan call, 2026-06-14). Swapping the creative on a live
// campaign costs a flat fee per change (covers the manual approval effort, which
// auto-populates to every screen). The "unlimited changes" membership is the
// upsell: while it's active, changes are free. Changes also carry a 30-day notice
// expectation, surfaced in the UI.
export const AD_CHANGE_FEE_CENTS = 1000 // $10 per creative change
export const AD_CHANGE_NOTICE_DAYS = 30 // notice we ask advertisers to give
// Monthly price of the unlimited-changes membership. Inline price (the app uses
// price_data everywhere, no dashboard Price IDs), so adjust here to reprice.
export const UNLIMITED_CHANGES_CENTS = 2900 // $29 / month

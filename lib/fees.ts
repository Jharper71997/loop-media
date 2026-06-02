// Creative-help pricing (client-safe constants — no server imports).
// Charged only when an advertiser chooses "Request creative help" (uploading
// their own creative stays free). One-time setup hits the first invoice; the
// refresh recurs monthly alongside the plan.
export const CREATIVE_SETUP_FEE_CENTS = 9900 // $99 one-time
export const CREATIVE_REFRESH_CENTS = 2000 // $20 / month

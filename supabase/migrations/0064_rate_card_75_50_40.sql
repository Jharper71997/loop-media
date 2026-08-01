-- Loop Network — the $75 / $50 / $40 rate card
--
-- Priced PER LOCATION (one venue = every TV in it), not per screen. The rungs
-- themselves live in lib/pricing.ts RATE_CARD, since volume is applied in code,
-- not from this table:
--
--    1-2 locations   $75 each
--    3-4 locations   $50 each   ($150 for 3)
--    5+  locations   $40 each   ($200 for 5, $40 each after)
--
-- What changes here is the BASE price every tier bills, from the live tiered
-- card ($50 local / $75 standard / $100 high / $125 premium) to a flat $75.
-- Every active venue currently resolves to `local` (price_tier is null and
-- foot_traffic_estimate is 0 network-wide), so in practice this moves the real
-- price of one location from $50 to $75, and volume is the only thing that
-- moves it back down.
--
-- max_discount_pct has to clear the top volume rung (46.7% at 5+) with room for
-- the 20% host discount and 5% loyalty on top, or a 5-screen host would hit the
-- old 35% cap and silently lose their host discount. 0.70 floors any screen at
-- $22.50.
--
-- Deliberately CLOBBERING: this is a repricing, so it overwrites the values an
-- admin set at /admin/pricing on 2026-07-07. exclusivity_price_cents is left
-- alone (host protection, not sold). Idempotent. Apply via the Supabase SQL
-- editor or `node scripts/run-sql.js supabase/migrations/0064_rate_card_75_50_40.sql`.
--
-- Existing Stripe subscriptions keep the price they were created at — nobody
-- already running gets repriced by this. It sets what NEW carts quote.

insert into pricing_config (id) values ('default')
on conflict (id) do nothing;

update pricing_config
set
  local_price_cents    = 7500,
  standard_price_cents = 7500,
  high_price_cents     = 7500,
  premium_price_cents  = 7500,
  min_monthly_cents    = 0,
  max_discount_pct     = 0.700,
  updated_at           = now()
where id = 'default';

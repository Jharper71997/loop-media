-- Loop Network — retire host "free promo slots"; add the host advertising comp code.
--
-- The 2 free host promo slots (host-owned ads that ran on OTHER venues) are
-- replaced by a simpler model: a host advertises through the normal buy flow and
-- gets a 100%-off Stripe promotion code auto-generated from their business name
-- when their venue is approved + goes live. The code is stored on the venue and
-- entered at advertiser checkout (Stripe Checkout already allows promotion codes).
--
-- This drops the host-promo slot-limit trigger (no more host ads are created) and
-- adds venues.comp_promo_code. Existing host-owned ads, if any, are left as-is.
--
-- Apply via the Supabase SQL editor or scripts/apply-migrations.js, in order.

drop trigger if exists trg_host_promo_limit on ads;
drop function if exists enforce_host_promo_limit();

alter table venues add column if not exists comp_promo_code text;

comment on column venues.comp_promo_code is
  'Stripe promotion code (100% off, from the business name) minted when the venue goes live; the host enters it at advertiser checkout.';

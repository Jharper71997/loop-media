-- Per-venue custom monthly price override.
--
-- NULL (the default) = use the venue's tier price. When set, this cents value is
-- the screen's monthly list price EVERYWHERE: admin display, the advertiser cart,
-- and what Stripe bills. Lets a single venue be priced off its tier bucket.
alter table public.venues
  add column if not exists price_cents_override integer;

comment on column public.venues.price_cents_override is
  'Optional per-venue monthly price in cents. NULL = use the tier price. Overrides the tier for this venue only.';

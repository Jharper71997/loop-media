-- 0023_pricing_config.sql
-- Move the hardcoded pricing constants out of lib/pricing.ts into the DB so admins
-- can edit tier prices, the account minimum, and the discount knobs live from
-- /admin/pricing. lib/pricing.ts still exports DEFAULT_PRICING_CONFIG as the
-- fallback; getPricingConfig() reads this row and quoteCart() takes it as a param.
--
-- Seeded at the $75 screen floor: Local 75, Standard 85, High 95, Premium 120.

create table if not exists pricing_config (
  id                        text primary key default 'default',
  local_price_cents         int  not null default 7500,
  standard_price_cents      int  not null default 8500,
  high_price_cents          int  not null default 9500,
  premium_price_cents       int  not null default 12000,
  min_monthly_cents         int  not null default 20000,
  host_discount_pct         numeric(4,3) not null default 0.200,
  loyalty_12mo_discount_pct numeric(4,3) not null default 0.050,
  max_discount_pct          numeric(4,3) not null default 0.350,
  updated_at                timestamptz not null default now()
);

alter table pricing_config enable row level security;

-- Anyone signed in can read prices (the cart needs them); only admins write.
do $$ begin
  create policy pricing_config_select on pricing_config
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy pricing_config_admin_write on pricing_config
    for all to authenticated using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- One config row; defaults above give the $75-floor ladder.
insert into pricing_config (id) values ('default')
on conflict (id) do nothing;

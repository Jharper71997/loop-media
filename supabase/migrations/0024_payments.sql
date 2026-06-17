-- 0024_payments.sql
-- Factual cash ledger: every real Stripe charge is recorded here so the admin
-- Revenue page reports money ACTUALLY collected, not contracted/active-sub value.
-- Written only by the Stripe webhook (service role); admins read it. Stays empty
-- until Stripe is connected, so "Collected" correctly reads $0 until then.

create table if not exists payments (
  id                  uuid primary key default gen_random_uuid(),
  advertiser_id       uuid references profiles(id) on delete set null,
  campaign_id         uuid references campaigns(id) on delete set null,
  territory_id        uuid references territories(id) on delete set null,
  source              text not null default 'subscription', -- subscription | membership | ad_change | other
  amount_cents        int  not null,
  currency            text not null default 'usd',
  stripe_ref          text unique,        -- invoice id or checkout session id (idempotency)
  stripe_customer_id  text,
  paid_at             timestamptz not null default now(),
  created_at          timestamptz not null default now()
);
create index if not exists idx_payments_paid_at on payments(paid_at);
create index if not exists idx_payments_territory on payments(territory_id);

alter table payments enable row level security;

-- Admins read the ledger (Revenue page uses the user session). The webhook writes
-- with the service-role client, which bypasses RLS, so no insert policy is needed.
do $$ begin
  create policy payments_admin_read on payments
    for select to authenticated using (is_admin());
exception when duplicate_object then null; end $$;

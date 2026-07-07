-- Loop Network — advertiser credits ledger (starting with SLA uptime credits)
--
-- Billing was fully decoupled from uptime: a dead screen still billed full monthly
-- despite the ~80% business-hours SLA, with no refund/credit concept anywhere. This
-- adds a credits ledger. The sla-credits job (app/api/cron/sla-credits) measures
-- each screen's prior-month uptime and, for screens under the SLA, issues a prorated
-- Stripe customer-balance credit (applied to the next invoice) and records it here.
--
-- Idempotent: one credit per (tv, campaign, reason, month). Apply via the Supabase
-- SQL editor or `scripts/apply-migrations.js`.

create table if not exists credits (
  id            uuid primary key default gen_random_uuid(),
  advertiser_id uuid references profiles(id)    on delete set null,
  campaign_id   uuid references campaigns(id)   on delete set null,
  tv_id         uuid references tvs(id)         on delete set null,
  territory_id  uuid references territories(id) on delete set null,
  amount_cents  int  not null check (amount_cents > 0),
  reason        text not null,          -- e.g. 'sla_uptime'
  period_month  text not null,          -- 'YYYY-MM'
  stripe_ref    text,                   -- Stripe balance transaction id (null if unissued)
  created_at    timestamptz not null default now()
);

-- One credit per screen+campaign+reason+month so the job is safe to re-run.
create unique index if not exists credits_uniq
  on credits (tv_id, campaign_id, reason, period_month);

alter table credits enable row level security;

do $$ begin
  create policy credits_owner on credits for select to authenticated
    using (advertiser_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy credits_admin on credits for select to authenticated
    using (is_admin());
exception when duplicate_object then null; end $$;

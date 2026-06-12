-- Loop Network — admin placement overrides (exclusions).
--
-- Placement is target-driven: an active campaign's ad fills the screens the
-- advertiser picked (campaign_targets). An admin can still PULL an ad off a
-- specific screen from the TV page. Without a durable marker the nightly
-- placement engine would just re-add it (the ad+tv unique index ignores 'ended'
-- rows), silently undoing the admin. A row here means "keep THIS campaign off
-- THIS tv" — the engine skips it. Removed when an admin re-adds the ad.
--
-- Idempotent.

create table if not exists placement_exclusions (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  tv_id       uuid not null references tvs(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (campaign_id, tv_id)
);
create index if not exists idx_placement_excl_campaign on placement_exclusions(campaign_id);
create index if not exists idx_placement_excl_tv on placement_exclusions(tv_id);

alter table placement_exclusions enable row level security;
-- Admin-only visibility; the engine + admin actions write via the service role.
do $$ begin
  create policy placement_excl_admin on placement_exclusions for select to authenticated using (is_admin());
exception when duplicate_object then null; end $$;

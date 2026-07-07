-- Loop Network — monthly placement snapshots.
--
-- The monthly report built its "where it ran" list from CURRENTLY-active placements,
-- so a screen the ad ran on during the month but was paused/removed by report time
-- dropped out of the per-location breakdown (its scans still counted in the total,
-- but couldn't be attributed). This records, per month, every screen a campaign ran
-- on at any point — accumulated daily by the existing `place` cron (upsert, so a
-- screen active on any day that month lands here) and read back by the report.
--
-- Apply via the Supabase SQL editor or scripts/apply-migrations.js, in order.

create table if not exists placement_snapshots (
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  tv_id        uuid not null references tvs(id)       on delete cascade,
  venue_id     uuid references venues(id)             on delete set null,
  period_month text not null,               -- 'YYYY-MM'
  created_at   timestamptz not null default now(),
  primary key (campaign_id, tv_id, period_month)
);

create index if not exists placement_snapshots_period on placement_snapshots (campaign_id, period_month);

alter table placement_snapshots enable row level security;

-- Admin read only; all writes are server-side (service role) from the crons.
do $$ begin
  create policy placement_snapshots_admin on placement_snapshots for select to authenticated
    using (is_admin());
exception when duplicate_object then null; end $$;

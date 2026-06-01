-- Loop Media — per-campaign screen targeting.
-- When an advertiser hand-picks venues, the placement engine restricts to this
-- set (still honoring exclusivity, caps, and slot availability). No rows for a
-- campaign = auto-place across all eligible screens (the original behavior).
create table if not exists campaign_targets (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  venue_id    uuid not null references venues(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (campaign_id, venue_id)
);
create index if not exists idx_campaign_targets_campaign on campaign_targets(campaign_id);

alter table campaign_targets enable row level security;

-- Advertiser manages targets for their own campaigns; admins manage all. The
-- placement engine reads these via the service role (bypasses RLS).
create policy ct_owner on campaign_targets for all to authenticated
  using (campaign_id in (select id from campaigns where advertiser_id = auth.uid()))
  with check (campaign_id in (select id from campaigns where advertiser_id = auth.uid()));
create policy ct_admin on campaign_targets for all to authenticated
  using (is_admin()) with check (is_admin());

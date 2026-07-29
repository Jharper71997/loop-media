-- 0063_scheduled_creatives.sql
-- Content calendar: an advertiser plans their spots up to a year out instead of
-- remembering to swap creative the week of. One row = "on this date, this
-- campaign should start running this creative".
--
-- How a row goes live (lib/scheduledCreatives.ts, run nightly from
-- /api/cron/place):
--   * A row becomes due one day BEFORE run_on, so the swap sits in admin review
--     overnight and is approved and airing ON the advertiser's date. Every
--     scheduled swap still goes through the same review as a manual one — the
--     calendar changes WHEN a swap is submitted, never WHETHER it's reviewed.
--   * Applying reuses the manual-swap pipeline: it writes an ad_change_requests
--     row and calls applyAdChange, so fee accounting, audit history and the
--     Stripe webhook path all stay in one place.
--   * The weekly free change still applies. If the campaign already burned its
--     free change that week, the row stays 'scheduled' and is retried the next
--     night (status_note says why) rather than silently charging $10 to a card
--     while nobody is watching. A row that can't land within
--     SCHEDULED_STALE_DAYS of its date gives up as 'skipped'.
--
-- Re-runnable: guarded with IF NOT EXISTS throughout.

create table if not exists public.scheduled_creatives (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references public.campaigns(id) on delete cascade,
  advertiser_id  uuid not null references public.profiles(id) on delete cascade,
  -- What this spot is, in the advertiser's words ("Nickel Night", "Fall menu").
  -- Purely a label for the calendar; the ad's own title is unchanged.
  label          text not null default '',
  creative_url   text not null,
  creative_type  text not null default 'image', -- 'image' | 'video'
  run_on         date not null,
  -- 'scheduled' (waiting), 'applied' (pushed to the ad), 'canceled' (advertiser
  -- pulled it), 'skipped' (never landed — see status_note)
  status         text not null default 'scheduled',
  status_note    text,
  ad_change_id   uuid references public.ad_change_requests(id) on delete set null,
  applied_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists scheduled_creatives_campaign_idx
  on public.scheduled_creatives (campaign_id, run_on);
create index if not exists scheduled_creatives_due_idx
  on public.scheduled_creatives (run_on) where status = 'scheduled';
create index if not exists scheduled_creatives_advertiser_idx
  on public.scheduled_creatives (advertiser_id, run_on);

-- One pending swap per campaign per day. Two creatives fighting over the same
-- date is always a mistake, and the calendar UI has no way to show it.
create unique index if not exists scheduled_creatives_one_per_day
  on public.scheduled_creatives (campaign_id, run_on) where status = 'scheduled';

do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_scheduled_creatives_updated'
  ) then
    create trigger trg_scheduled_creatives_updated
      before update on public.scheduled_creatives
      for each row execute function set_updated_at();
  end if;
end $$;

-- RLS: advertisers read their own calendar. All writes go through the
-- service-role client (server actions + cron), which bypasses RLS.
alter table public.scheduled_creatives enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'scheduled_creatives'
      and policyname = 'scheduled_creatives_owner_read'
  ) then
    create policy scheduled_creatives_owner_read on public.scheduled_creatives
      for select using (advertiser_id = auth.uid());
  end if;
end $$;

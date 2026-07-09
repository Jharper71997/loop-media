-- Loop Network — demo mode.
--
-- Adds an `is_demo` flag to the four tables a guided sales demo writes to. A demo
-- account (host or advertiser) is provisioned server-side (see lib/demo.ts) with
-- profiles.is_demo = true, and everything it creates inherits the flag. The app
-- then keeps demo content OUT of every real-facing surface:
--   • the placement engine / nightly cron never place a demo campaign on a real TV
--   • the advertiser + host buy maps hide demo venues (demo users still see the
--     real network — that's the whole point of the demo)
--   • admin lists + revenue exclude demo rows
-- Demo users see the real world; nobody real ever sees demo data. Demo rows are
-- disposable and periodically purged (lib/demo.ts cleanupStaleDemo).
--
-- Apply via the Supabase SQL editor or scripts/apply-migrations.js, in order.

alter table profiles  add column if not exists is_demo boolean not null default false;
alter table venues    add column if not exists is_demo boolean not null default false;
alter table ads       add column if not exists is_demo boolean not null default false;
alter table campaigns add column if not exists is_demo boolean not null default false;

comment on column profiles.is_demo is
  'True for throwaway accounts created by the guided /demo/host and /demo/advertiser walkthroughs. Everything they create is also is_demo and stays hidden from real users, admins, revenue, and the TVs.';

-- Partial indexes: the hot paths all read the real (non-demo) slice, so index
-- exactly that. Tiny — demo rows are few and short-lived.
create index if not exists venues_real_active_idx    on venues (territory_id) where is_demo = false;
create index if not exists campaigns_real_active_idx on campaigns (status)    where is_demo = false;

-- Loop Network — name the tailnet device behind a screen, so a button can reach
-- it directly instead of waiting to be asked.
--
-- 0078 gave screens a command queue that rides the player's 30s poll. That is
-- the right floor: it works through any venue's NAT, needs nothing installed
-- anywhere, and a screen that is offline simply does the work when it returns.
-- But it has two limits that matter when you are standing in front of the admin
-- wanting a dark TV to light up. It waits for the screen to ask, and it cannot
-- do anything at all when the player is the thing that has died.
--
-- Every company-owned screen is also on the Tailscale tailnet with ADB over
-- network enabled, which is a second path that is immediate and does not need
-- the player alive. What was missing is the join: the tailnet knows a device as
-- "loops-7th-tv", and this table knows it as a row. One text column closes that.
--
-- Null means "no direct path" and is not a fault: that screen just uses the poll
-- like it always has. See scripts/tv-command-runner.js.
--
-- Apply via the Supabase SQL editor (no DATABASE_URL locally) or scripts/run-sql.js.

alter table public.tvs
  add column if not exists tailscale_host text;

comment on column public.tvs.tailscale_host is
  'MagicDNS hostname of this screen on the tailnet (e.g. loops-7th-tv). Lets the command runner reach the device over adb directly. Null = poll only.';

-- One device, one screen. A hostname typed onto two rows would send one screen's
-- commands to another TV, which is the kind of mistake you find out about from a
-- host rather than from a log.
create unique index if not exists tvs_tailscale_host_unique
  on public.tvs (tailscale_host)
  where tailscale_host is not null;

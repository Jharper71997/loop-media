-- Loop Network — turn a screen's panel off and on: on a schedule, or on command.
--
-- Two things a screen could not do until now:
--
--   1. SLEEP WHEN THE VENUE IS CLOSED. Every screen currently runs 24/7 because
--      the app holds a screen-bright wake lock and the TV's own sleep timer is
--      disabled at install (it has to be, or the panel dozes mid-shift and the
--      host reports a dark screen). So a bar open 4pm–midnight burns 16 hours of
--      panel a day playing ads to an empty room. Venue hours are already in
--      public.venues (0020 single window, 0057 per-day), so the schedule is a
--      per-screen opt-in, not a new set of times to maintain.
--
--   2. TAKE A COMMAND. The player polls /api/tv/loop every ~30s, which is a
--      control channel nobody was using. tv_commands is that channel's queue:
--      an admin enqueues "sleep"/"wake"/"reload"/"relaunch", the next poll
--      carries it to the screen, and the screen acks it. The ack is the point —
--      "I pressed the button" is not the same as "the screen did it", and every
--      previous remote fix (a drive out to the venue) had no record at all.
--
-- Nothing here changes what an untouched screen does: sleep_when_closed
-- defaults false, and a screen with no queued commands gets an empty list.
--
-- Apply via the Supabase SQL editor (no DATABASE_URL locally) or scripts/run-sql.js.

-- ---------- per-screen schedule opt-in ----------
alter table public.tvs
  add column if not exists sleep_when_closed boolean not null default false;

comment on column public.tvs.sleep_when_closed is
  'true = the panel sleeps outside the venue''s open hours and wakes before it opens. Hours come from the venue (business_hours, else business_open/close/days).';

-- ---------- command queue ----------
-- One row per button press. Deliberately append-only: rows are not deleted when
-- acked, because the history of "what did we send this screen and did it obey"
-- is the diagnostic record that made the fleet knowable in the first place.
create table if not exists public.tv_commands (
  id uuid primary key default gen_random_uuid(),
  tv_id uuid not null references public.tvs(id) on delete cascade,
  -- sleep    — panel off now (device-owner lockNow, else black + minimum backlight)
  -- wake     — panel on now, kiosk back in front
  -- reload   — reload the player page (stale content, wedged WebView)
  -- relaunch — restart the whole kiosk activity (the app itself is wedged)
  command text not null check (command in ('sleep', 'wake', 'reload', 'relaunch')),
  issued_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Handed to the screen in a /api/tv/loop response.
  delivered_at timestamptz,
  -- The screen came back and said what happened. ok=false + detail is how a
  -- command that could not run (e.g. sleep without device owner) becomes visible
  -- instead of looking like a screen that ignored you.
  acked_at timestamptz,
  ok boolean,
  detail text
);

-- The queue read on every poll: this screen's undelivered commands, oldest first.
create index if not exists tv_commands_pending
  on public.tv_commands (tv_id, created_at)
  where delivered_at is null;

-- The admin panel's "recent commands" list.
create index if not exists tv_commands_recent
  on public.tv_commands (tv_id, created_at desc);

alter table public.tv_commands enable row level security;

-- Same shape as house_slide_settings (0075): admins read and write through the
-- normal client, the TV routes use the service role (which bypasses RLS), and
-- there is deliberately no anon policy — a screen must never be able to read or
-- forge another screen's commands.
drop policy if exists "lm_tv_commands_admin_all" on public.tv_commands;
create policy "lm_tv_commands_admin_all" on public.tv_commands
  for all to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

comment on table public.tv_commands is
  'Queue of remote commands for a screen. Delivered on the next /api/tv/loop poll and acked by the player. Append-only: the history is the diagnostic record.';

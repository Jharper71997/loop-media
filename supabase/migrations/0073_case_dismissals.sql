-- 0073_case_dismissals.sql
-- Letting the admin clear a case off the board.
--
-- Cases are DERIVED — loadCases() recomputes them from live data on every page
-- load, so there is nothing to "mark done". A screen you already texted the
-- venue about, a host you already promised free screens to, an unsold venue you
-- have decided not to work this month: all of them keep reappearing at full
-- volume, and a board that will not empty is a board you stop reading. That is
-- the whole reason 26 open cases read as junk.
--
-- So dismissal is stored beside the derived case, keyed on the case's stable id
-- (`<kind>:<subjectId>`), and applied as a filter when the board is assembled.
--
-- SNOOZED, NOT DELETED. Two things bring a dismissed case back on its own:
--
--   1. `until` passes. A snooze is a promise to look again, not a mute.
--   2. It gets worse. We record what the case looked like when it was waved off
--      (severity + monthly dollars). If either deteriorates past the threshold
--      in lib/caseDismissals.ts, the case reopens immediately regardless of
--      `until` — otherwise "not now" on a $50 problem would silently hide the
--      same problem at $500. A dismissal is permission to ignore THIS, not
--      whatever it becomes.
--
-- `until` null means "until it changes": no clock, but rule 2 still applies.
--
-- Re-runnable: guarded with IF NOT EXISTS throughout.

create table if not exists public.case_dismissals (
  id             uuid primary key default gen_random_uuid(),
  -- `<kind>:<subjectId>` exactly as lib/cases.ts builds it. Text, not a foreign
  -- key: the subject is a tv, a campaign, a venue or a host depending on kind,
  -- and the case itself has no row anywhere to point at.
  case_id        text not null,
  -- Null = "until it changes". Otherwise the moment it comes back by itself.
  until          timestamptz,
  -- What it looked like when it was dismissed, so a worsening case can reopen.
  severity       text not null,
  money_cents    integer not null default 0,
  -- Optional note, shown when the case reappears so the next look has context.
  reason         text,
  dismissed_by   uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- One live dismissal per case. Re-dismissing updates the existing row (upsert on
-- this constraint) rather than stacking rows nobody would ever clean up.
create unique index if not exists case_dismissals_case_idx
  on public.case_dismissals (case_id);

-- The board reads every non-expired dismissal on each load.
create index if not exists case_dismissals_until_idx
  on public.case_dismissals (until);

-- RLS: admin-only, both directions. Nothing outside the admin has any business
-- reading or writing these.
alter table public.case_dismissals enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'case_dismissals'
      and policyname = 'case_dismissals_admin'
  ) then
    create policy case_dismissals_admin on public.case_dismissals
      for all to authenticated using (is_admin()) with check (is_admin());
  end if;
end $$;

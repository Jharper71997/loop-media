-- First-run host walkthrough. Tracks whether a host has finished (or skipped) the
-- guided spotlight tour, so it fires once per account and never re-nags — including
-- on a new device, which the old localStorage-only flag couldn't guarantee.
--
-- Read in app/host/layout.tsx to decide auto-start; set true by the completeHostTour
-- server action on finish/skip. Users can replay the tour anytime from Account.

alter table profiles
  add column if not exists onboarding_host_done boolean not null default false;

-- Existing accounts already know the app — don't surprise them with the tour on
-- their next visit. Only hosts who sign up AFTER this migration (column default
-- false) see it. New signups get false via the default and the profiles trigger.
update profiles set onboarding_host_done = true;

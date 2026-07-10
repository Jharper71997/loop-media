-- 0057_per_day_hours.sql
-- Per-day business hours, so a venue can be open different hours on different days
-- (e.g. Sun 1–5 PM but Mon–Fri 9 AM–5 PM). The single-window columns from 0020
-- (business_open/close + business_days) can only express one window for all open
-- days.
--
-- Model: business_hours is a JSON object keyed by weekday '0'..'6' (0=Sunday, to
-- match business_days and isWithinOpenHours). Each value is the open window that
-- day: { "open": "HH:MM", "close": "HH:MM" } in local wall-clock. A weekday with
-- no key means CLOSED that day.
--
-- Authoritative when present: lib/openHours.ts + lib/uptime.ts read business_hours
-- first and fall back to the legacy single-window columns when it's null. Existing
-- rows stay null and behave exactly as before — this is purely additive.
--
-- Example:
--   { "1": {"open":"09:00","close":"17:00"},
--     "2": {"open":"09:00","close":"17:00"},
--     "0": {"open":"13:00","close":"17:00"} }
--
-- Re-runnable.

alter table public.venues
  add column if not exists business_hours jsonb;

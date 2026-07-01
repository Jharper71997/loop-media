-- Trivia is now per-venue and OFF by default. Instead of auto-showing on every
-- TV, the phone-trivia game only runs on the screens of venues an admin has
-- explicitly turned it on for. Existing venues default to off (trivia stops
-- everywhere until assigned).
alter table venues
  add column if not exists trivia_enabled boolean not null default false;

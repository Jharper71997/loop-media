-- Loop Network — name a house-slide upload.
--
-- /admin/house lists every creative ever uploaded for a slide so an old one can be
-- brought back, but the only thing distinguishing them was an upload timestamp.
-- Picking "the Christmas one" out of four rows that all read "Aug 14, 2026" is
-- guesswork, and guessing wrong puts the wrong ad on ten screens.
--
-- Nullable on purpose: existing uploads keep showing their date until someone
-- bothers to name them, and naming is never required to upload.
--
-- Apply via the Supabase SQL editor or scripts/run-sql.js.

alter table public.house_creatives
  add column if not exists label text;

comment on column public.house_creatives.label is
  'Admin-given name for this upload ("Christmas 2026"). NULL = show its upload date instead.';

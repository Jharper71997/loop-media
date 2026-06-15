-- 0022_security_fixes.sql
-- Security + payment-integrity hardening from the 2026-06-14 audit. Re-runnable.
--
--  1. Storage: scope creative/promo writes to the uploader's OWN folder. The
--     0005 policies let ANY authenticated user overwrite ANY object (the buckets
--     are public-read and every object path is exposed on TV screens), so a
--     competitor could replace a live ad's creative. Uploads are always written
--     as `<auth.uid()>/<uuid>.<ext>` (see CreativeStep / PromoSlots / Replace-
--     Creative), so the first path segment must equal the caller's uid.
--  2. processed_stripe_events: dedupe table so a replayed Stripe webhook event
--     can't double-activate / double-charge. Service-role only.
--  3. memberships: a partial unique index so an advertiser can't end up with two
--     active 'unlimited_changes' rows (= two live $29/mo Stripe subscriptions).

-- ---- 1. storage owner scoping ----------------------------------------------
drop policy if exists "lm_creatives_insert" on storage.objects;
create policy "lm_creatives_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('creatives', 'host-promos')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "lm_creatives_update" on storage.objects;
create policy "lm_creatives_update" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('creatives', 'host-promos')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('creatives', 'host-promos')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Block deletes too (was implicitly denied — make it explicit + owner-scoped so
-- an advertiser can replace their own files but not delete a competitor's).
drop policy if exists "lm_creatives_delete" on storage.objects;
create policy "lm_creatives_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('creatives', 'host-promos')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---- 2. stripe webhook idempotency -----------------------------------------
create table if not exists public.processed_stripe_events (
  event_id     text primary key,
  type         text,
  processed_at timestamptz not null default now()
);
alter table public.processed_stripe_events enable row level security;
-- No policies on purpose: only the service-role client (webhook) touches it.

-- ---- 3. one active membership per (advertiser, kind) ------------------------
create unique index if not exists memberships_one_active
  on public.memberships (advertiser_id, kind)
  where status = 'active';

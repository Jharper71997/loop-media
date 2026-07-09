-- Venue logo: a per-venue business logo the host uploads and edits themselves.
-- It shows on the advertiser browse map (as the pin + in the popup) so a venue
-- reads as a real business — more credibility when advertisers pick screens.
-- Idempotent (add-column-if-not-exists + drop/create policies), safe to re-run.

-- 1. Column on venues. Nullable text — the public URL of the uploaded logo, or
--    null when the host hasn't set one (the map falls back to the plain dot).
alter table public.venues add column if not exists logo_url text;

-- 2. Public storage bucket for the logo images. Public read (the browse map is
--    advertiser-facing and needs to load the image without a signed URL), same
--    as the creatives / host-promos buckets.
insert into storage.buckets (id, name, public)
values ('venue-logos', 'venue-logos', true)
on conflict (id) do nothing;

-- 3. Owner-scoped write policies. A host may only write objects under their own
--    uid folder (path convention <auth.uid()>/<uuid>.png), matching the scoping
--    the creatives/host-promos buckets got in 0022_security_fixes.sql. The new
--    bucket is NOT covered by those policies' bucket_id lists, so it needs its own.
drop policy if exists "lm_venue_logos_insert" on storage.objects;
create policy "lm_venue_logos_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'venue-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "lm_venue_logos_update" on storage.objects;
create policy "lm_venue_logos_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'venue-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'venue-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "lm_venue_logos_delete" on storage.objects;
create policy "lm_venue_logos_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'venue-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 4. Public read (bucket is public; explicit policy for completeness / parity).
drop policy if exists "lm_venue_logos_read" on storage.objects;
create policy "lm_venue_logos_read" on storage.objects
  for select to public
  using (bucket_id = 'venue-logos');

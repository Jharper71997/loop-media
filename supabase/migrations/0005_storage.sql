-- Storage buckets for ad creatives + host promos (public read for the TV loop).

insert into storage.buckets (id, name, public)
values ('creatives', 'creatives', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('host-promos', 'host-promos', true)
on conflict (id) do nothing;

-- Authenticated users may upload/replace objects in these buckets.
drop policy if exists "lm_creatives_insert" on storage.objects;
create policy "lm_creatives_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('creatives', 'host-promos'));

drop policy if exists "lm_creatives_update" on storage.objects;
create policy "lm_creatives_update" on storage.objects
  for update to authenticated
  using (bucket_id in ('creatives', 'host-promos'));

-- Public read (buckets are public; explicit policy for completeness).
drop policy if exists "lm_creatives_read" on storage.objects;
create policy "lm_creatives_read" on storage.objects
  for select to public
  using (bucket_id in ('creatives', 'host-promos'));

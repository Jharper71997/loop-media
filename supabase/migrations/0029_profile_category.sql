-- Remember an advertiser's line of business on their account so we ask it ONCE
-- (browse Step 1) and reuse it on every future campaign — no more re-picking the
-- category on the creative step or on the next purchase. Null for hosts/admins.
-- (No DO block, so it also runs in the Supabase SQL editor.)

alter table profiles
  add column if not exists category_id uuid references categories(id) on delete set null;

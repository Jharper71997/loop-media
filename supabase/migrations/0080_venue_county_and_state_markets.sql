-- Loop Network — venues are classified by STATE and COUNTY, never by city.
--
-- Two things:
--
-- 1. venues.county. The market (territory) is the state; county is the only level
--    below it. Filled from the geocoder when a venue's address is saved, and
--    editable by an admin. City stays on the venue as part of the street address
--    and nothing else — it is not a classification.
--
-- 2. Fold the city markets that crept back in after 0076 into their state. 0076 was
--    applied to prod on 2026-09-07 but the code half of that change never reached
--    main, so the live app kept minting "City, ST" markets (Hebron, IN; Melbourne,
--    FL; Rockledge, FL). 0076 can't simply be re-run: its keeper is the OLDEST
--    city row per state, which would now be renamed onto a slug ("florida") that
--    the real state row already holds. Here the keeper is the EXISTING state row,
--    and only a state with no state row yet promotes its oldest city row.
--
-- One `do` block for the same reason as 0076 (the SQL editor's pooler can put
-- consecutive statements on different connections). Safe to re-run: with no
-- "city-st" rows left it does nothing.

alter table public.venues add column if not exists county text;

comment on column public.venues.county is
  'County the venue is in (e.g. "Onslow County"). The only classification below the state market. Set from the geocoder on save.';

do $mig$
declare
  fk record;
begin
  create temp table t_states (code text, state_name text, state_slug text, tz text) on commit drop;
  insert into t_states values
    ('AL','Alabama','alabama','America/Chicago'),
    ('AK','Alaska','alaska','America/Anchorage'),
    ('AZ','Arizona','arizona','America/Phoenix'),
    ('AR','Arkansas','arkansas','America/Chicago'),
    ('CA','California','california','America/Los_Angeles'),
    ('CO','Colorado','colorado','America/Denver'),
    ('CT','Connecticut','connecticut','America/New_York'),
    ('DE','Delaware','delaware','America/New_York'),
    ('DC','District of Columbia','district-of-columbia','America/New_York'),
    ('FL','Florida','florida','America/New_York'),
    ('GA','Georgia','georgia','America/New_York'),
    ('HI','Hawaii','hawaii','Pacific/Honolulu'),
    ('ID','Idaho','idaho','America/Boise'),
    ('IL','Illinois','illinois','America/Chicago'),
    ('IN','Indiana','indiana','America/Indiana/Indianapolis'),
    ('IA','Iowa','iowa','America/Chicago'),
    ('KS','Kansas','kansas','America/Chicago'),
    ('KY','Kentucky','kentucky','America/New_York'),
    ('LA','Louisiana','louisiana','America/Chicago'),
    ('ME','Maine','maine','America/New_York'),
    ('MD','Maryland','maryland','America/New_York'),
    ('MA','Massachusetts','massachusetts','America/New_York'),
    ('MI','Michigan','michigan','America/Detroit'),
    ('MN','Minnesota','minnesota','America/Chicago'),
    ('MS','Mississippi','mississippi','America/Chicago'),
    ('MO','Missouri','missouri','America/Chicago'),
    ('MT','Montana','montana','America/Denver'),
    ('NE','Nebraska','nebraska','America/Chicago'),
    ('NV','Nevada','nevada','America/Los_Angeles'),
    ('NH','New Hampshire','new-hampshire','America/New_York'),
    ('NJ','New Jersey','new-jersey','America/New_York'),
    ('NM','New Mexico','new-mexico','America/Denver'),
    ('NY','New York','new-york','America/New_York'),
    ('NC','North Carolina','north-carolina','America/New_York'),
    ('ND','North Dakota','north-dakota','America/Chicago'),
    ('OH','Ohio','ohio','America/New_York'),
    ('OK','Oklahoma','oklahoma','America/Chicago'),
    ('OR','Oregon','oregon','America/Los_Angeles'),
    ('PA','Pennsylvania','pennsylvania','America/New_York'),
    ('RI','Rhode Island','rhode-island','America/New_York'),
    ('SC','South Carolina','south-carolina','America/New_York'),
    ('SD','South Dakota','south-dakota','America/Chicago'),
    ('TN','Tennessee','tennessee','America/Chicago'),
    ('TX','Texas','texas','America/Chicago'),
    ('UT','Utah','utah','America/Denver'),
    ('VT','Vermont','vermont','America/New_York'),
    ('VA','Virginia','virginia','America/New_York'),
    ('WA','Washington','washington','America/Los_Angeles'),
    ('WV','West Virginia','west-virginia','America/New_York'),
    ('WI','Wisconsin','wisconsin','America/Chicago'),
    ('WY','Wyoming','wyoming','America/Denver'),
    ('PR','Puerto Rico','puerto-rico','America/Puerto_Rico');

  -- ---------- 1. city markets ("city-st" slugs) and their state ----------
  create temp table t_city on commit drop as
  select t.id, t.created_at, s.code, s.state_name, s.state_slug, s.tz
  from public.territories t
  join t_states s on s.code = upper(right(t.slug, 2))
  where not t.is_holding
    and t.slug ~ '-[a-z]{2}$'
    -- A state slug like "west-virginia" never ends in a two-letter piece, but be
    -- explicit: a real state row is never treated as a city.
    and t.slug not in (select state_slug from t_states);

  if not exists (select 1 from t_city) then
    return;
  end if;

  -- ---------- 2. a state with no state row yet: promote its oldest city row ----------
  update public.territories t
  set name = c.state_name,
      slug = c.state_slug,
      timezone = c.tz,
      parent_id = coalesce(
        t.parent_id,
        (select h.id from public.territories h where h.is_holding order by h.created_at limit 1)
      )
  from (
    select distinct on (code) id, state_name, state_slug, tz
    from t_city
    where state_slug not in (select slug from public.territories)
    order by code, created_at, id
  ) c
  where t.id = c.id;

  -- ---------- 3. which city row merges into which state row ----------
  create temp table t_state_merge on commit drop as
  select c.id as from_id, st.id as to_id
  from t_city c
  join public.territories st on st.slug = c.state_slug
  where st.id <> c.id;

  -- ---------- 4. clear the collisions a merge would cause ----------
  delete from public.category_caps c
  using t_state_merge m
  where c.territory_id = m.from_id
    and exists (
      select 1 from public.category_caps k
      where k.territory_id = m.to_id and k.category_id = c.category_id
    );

  delete from public.package_territory_prices p
  using t_state_merge m
  where p.territory_id = m.from_id
    and exists (
      select 1 from public.package_territory_prices k
      where k.territory_id = m.to_id and k.package_id = p.package_id
    );

  -- house_slide_settings is one row per (kind, territory); the state's own setting wins.
  delete from public.house_slide_settings h
  using t_state_merge m
  where h.territory_id = m.from_id
    and exists (
      select 1 from public.house_slide_settings k
      where k.territory_id = m.to_id and k.kind = h.kind
    );

  -- house_creatives allows ONE ACTIVE row per (kind, territory): keep the newest,
  -- pause the rest (same as a manual retire on /admin/house).
  with moving as (
    select h.id, h.kind, m.to_id, h.created_at
    from public.house_creatives h
    join t_state_merge m on m.from_id = h.territory_id
    where h.active
  ),
  staying as (
    select h.id, h.kind, h.territory_id as to_id, h.created_at
    from public.house_creatives h
    where h.active
      and h.territory_id in (select distinct to_id from t_state_merge)
  ),
  ranked as (
    select id,
           row_number() over (partition by kind, to_id order by created_at desc, id) as rn
    from (select * from moving union all select * from staying) x
  )
  update public.house_creatives h
  set active = false
  from ranked r
  where h.id = r.id and r.rn > 1;

  -- ---------- 5. repoint every foreign key ----------
  for fk in
    select
      con.conrelid::regclass::text as tbl,
      att.attname                  as col
    from pg_constraint con
    join pg_class ref on ref.oid = con.confrelid
    join pg_namespace refns on refns.oid = ref.relnamespace
    join unnest(con.conkey) as k(attnum) on true
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
    where con.contype = 'f'
      and ref.relname = 'territories'
      and refns.nspname = 'public'
      and array_length(con.conkey, 1) = 1
  loop
    execute format(
      'update %s t set %I = m.to_id from t_state_merge m where t.%I = m.from_id',
      fk.tbl, fk.col, fk.col
    );
  end loop;

  -- ---------- 6. the city rows now hold nothing: remove them ----------
  delete from public.territories t
  using t_state_merge m
  where t.id = m.from_id;
end
$mig$;

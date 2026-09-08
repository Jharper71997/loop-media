-- Loop Network — one market per STATE, not per city.
--
-- A venue's market was derived from its city + state and created on the fly, so
-- every new host in a new town minted a market of one: Jacksonville, Hubert,
-- Swansboro and Onslow were four separate "markets" on the same 20-mile stretch of
-- NC coast, and Cocoa + Cocoa Beach were two in Florida. Everything that scopes by
-- market — category caps, exclusivity, per-market pricing, trivia questions, house
-- slides, the admin market switcher — was being split along lines that mean nothing
-- to a buyer. States are the level Loop Network actually sells and staffs.
--
-- This migration MERGES the existing city markets into one row per state, keeping
-- the OLDEST row of each state (so the market with the history keeps its id, and
-- the admin territory cookie, any territory-pinned admin profile, and every foreign
-- key that already points at it stay valid) and renaming it to the state.
--
-- Repointing is generic: it walks every foreign key that references territories(id)
-- from pg_catalog, so a table added since this was written is still carried over.
--
-- THE WHOLE THING IS ONE `do` BLOCK ON PURPOSE. The first draft used a temp table
-- across several top-level statements and died in the Supabase SQL editor with
-- `relation "t_state_merge" does not exist`: the editor talks to Postgres through a
-- transaction-mode pooler, so consecutive statements can land on different backend
-- connections and a temp table made by one is invisible to the next. A single `do`
-- block is a single statement — one connection, one transaction, all-or-nothing. An
-- explicit begin/commit is NOT wanted here for the same reason.
--
-- Safe to re-run: it only touches rows whose slug still looks like "city-st", so a
-- database already merged to state slugs is left alone.
--
-- Apply via the Supabase SQL editor or scripts/run-sql.js.

do $mig$
declare
  fk record;
begin
  -- ---------- 1. which rows merge into which ----------
  -- Existing markets are named "City, ST" with slug "city-st", so the state is the
  -- last dash-separated piece of the slug. Rows that don't parse as a US state
  -- (junk like "asdf, SF", anything hand-made, and every already-merged state slug)
  -- are left completely alone.
  create temp table t_state_merge on commit drop as
  with parsed as (
    select
      t.id,
      t.created_at,
      upper(right(t.slug, 2)) as state_code
    from public.territories t
    where not t.is_holding
      and t.slug ~ '-[a-z]{2}$'
      and upper(right(t.slug, 2)) in (
        'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA',
        'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
        'NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA',
        'WV','WI','WY','PR'
      )
  ),
  keeper as (
    -- Oldest row per state wins: it's the one with the venues, ads and history.
    select distinct on (state_code) state_code, id as keep_id
    from parsed
    order by state_code, created_at, id
  )
  select p.id as from_id, k.keep_id as to_id, p.state_code
  from parsed p
  join keeper k using (state_code);

  -- Nothing shaped like a city market left: already merged, or a fresh database.
  if not exists (select 1 from t_state_merge) then
    return;
  end if;

  -- ---------- 2. clear the collisions a merge would cause ----------
  -- Two markets in the same state can each hold a row that is unique per territory.
  -- Drop the losing duplicates BEFORE repointing, or the update below trips the
  -- unique index and the whole block rolls back.

  -- category_caps is unique (territory_id, category_id): keep the keeper's cap.
  delete from public.category_caps c
  using t_state_merge m
  where c.territory_id = m.from_id
    and m.from_id <> m.to_id
    and exists (
      select 1 from public.category_caps k
      where k.territory_id = m.to_id and k.category_id = c.category_id
    );

  -- package_territory_prices is unique (package_id, territory_id): same rule.
  delete from public.package_territory_prices p
  using t_state_merge m
  where p.territory_id = m.from_id
    and m.from_id <> m.to_id
    and exists (
      select 1 from public.package_territory_prices k
      where k.territory_id = m.to_id and k.package_id = p.package_id
    );

  -- house_creatives allows ONE ACTIVE row per (kind, territory). Where a merge would
  -- bring a second active row into the same market, retire the older one — it stays
  -- in the list as a paused upload the admin can bring back, exactly like a manual
  -- retire on /admin/house.
  with moving as (
    select h.id, h.kind, m.to_id, h.created_at
    from public.house_creatives h
    join t_state_merge m on m.from_id = h.territory_id
    where h.active and m.from_id <> m.to_id
  ),
  staying as (
    select h.id, h.kind, h.territory_id as to_id, h.created_at
    from public.house_creatives h
    where h.active
      and h.territory_id in (select distinct to_id from t_state_merge)
  ),
  ranked as (
    select id, kind, to_id, created_at,
           row_number() over (partition by kind, to_id order by created_at desc, id) as rn
    from (select * from moving union all select * from staying) x
  )
  update public.house_creatives h
  set active = false
  from ranked r
  where h.id = r.id and r.rn > 1;

  -- ---------- 3. repoint every foreign key ----------
  -- Generic over pg_catalog so nothing is missed, including tables added after this
  -- migration was written.
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
      -- Single-column FKs only. There are none composite today, and blindly
      -- rewriting one column of a composite key would be wrong.
      and array_length(con.conkey, 1) = 1
  loop
    execute format(
      'update %s t set %I = m.to_id from t_state_merge m
         where t.%I = m.from_id and m.from_id <> m.to_id',
      fk.tbl, fk.col, fk.col
    );
  end loop;

  -- ---------- 4. rename the keepers, retire the losers ----------
  -- The keeper becomes the state. Slug is the state name so /admin links and the
  -- market switcher read "North Carolina", not "Jacksonville, NC".
  update public.territories t
  set name = s.state_name,
      slug = s.state_slug,
      timezone = s.tz,
      -- Every market hangs off Holdings; the city rows created on the fly never set
      -- a parent, so tidy that up while we're here.
      parent_id = coalesce(
        t.parent_id,
        (select h.id from public.territories h where h.is_holding order by h.created_at limit 1)
      )
  from (
    select m.to_id, x.state_name, x.state_slug, x.tz
    from (select distinct to_id, state_code from t_state_merge) m
    join (values
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
      ('PR','Puerto Rico','puerto-rico','America/Puerto_Rico')
    ) as x(code, state_name, state_slug, tz) on x.code = m.state_code
  ) s
  where t.id = s.to_id;

  -- The merged-away rows now have nothing pointing at them, so they can go. Step 3
  -- repointed every FK, so a delete that still finds a dependent row raises and
  -- rolls the whole block back rather than cascading.
  delete from public.territories t
  using t_state_merge m
  where t.id = m.from_id and m.from_id <> m.to_id;
end
$mig$;

comment on table public.territories is
  'Markets. One row per state (plus the Holdings parent). Created on the fly by lib/territory.ts when a host registers in a new state.';

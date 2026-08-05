-- The sales pipeline.
--
-- Until now this app only knew about businesses that were ALREADY customers.
-- Every prospect being worked lived in Jacob's head, a spreadsheet, or GHL, so
-- the admin could not answer "who do I call today", "what did I say last time",
-- or "what am I owed a follow-up on". /admin/sell computes a call list from
-- inventory, but nothing about that call is ever recorded.
--
-- Two tables. Modelled on the GoHighLevel opportunity board Jacob already reads,
-- with the differences this business actually requires:
--
--   * TWO pipelines in one table, discriminated by `kind`. Loop sells ad slots to
--     advertisers AND recruits venues to host screens; the second creates the
--     inventory the first consumes, so they belong on one board.
--   * Value is MONTHLY, not a one-off deal size. Everything here is measured
--     against a $4,000/mo goal, so won value has to roll up as MRR.
--   * A prospect is NOT a user. profiles.id references auth.users, so every
--     existing "person" in this schema needs a login — useless for a bar you
--     have not pitched yet. Opportunities are free-standing rows; the auth user,
--     campaign, or venue is created at Won and linked back.

create table if not exists public.opportunities (
  id             uuid primary key default gen_random_uuid(),
  territory_id   uuid not null references public.territories (id) on delete restrict,

  -- 'advertiser' = a business that might buy slots.
  -- 'host'       = a venue that might take a screen.
  kind           text not null check (kind in ('advertiser', 'host')),

  -- Who they are. business_name is the only required field: a prospect scribbled
  -- on a napkin should still be enterable.
  business_name  text not null,
  contact_name   text,
  email          text,
  phone          text,
  website        text,
  address        text,
  city           text,
  -- What they sell. Drives who to pitch, and for hosts it is the category that
  -- becomes blocked at their venue (host protection).
  category_id    uuid references public.categories (id) on delete set null,

  -- Where it stands. Stage values are owned by lib/pipeline.ts rather than a
  -- CHECK, because stages are a workflow opinion that will be tuned; a constraint
  -- here would mean a migration every time a column is renamed on the board.
  stage          text not null,
  status         text not null default 'open' check (status in ('open', 'won', 'lost')),
  monthly_cents  integer not null default 0 check (monthly_cents >= 0),
  screens        integer check (screens is null or screens > 0),
  source         text,
  lost_reason    text,

  -- The follow-up. next_step_at is what surfaces the row in the Today queue, so
  -- it is indexed below.
  next_step      text,
  next_step_at   timestamptz,
  last_touch_at  timestamptz,

  -- Filled in once the deal converts, so the CRM is not a parallel universe.
  advertiser_id  uuid references public.profiles (id) on delete set null,
  campaign_id    uuid references public.campaigns (id) on delete set null,
  venue_id       uuid references public.venues (id) on delete set null,

  owner_id       uuid references public.profiles (id) on delete set null,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  won_at         timestamptz,
  lost_at        timestamptz
);

-- The board reads open rows for one territory grouped by stage.
create index if not exists opportunities_board_idx
  on public.opportunities (territory_id, kind, status, stage);
-- The Today queue reads due/overdue follow-ups across everything still open.
create index if not exists opportunities_followup_idx
  on public.opportunities (next_step_at)
  where status = 'open' and next_step_at is not null;
-- Reports group won/lost by source and by month.
create index if not exists opportunities_reporting_idx
  on public.opportunities (status, won_at, source);

do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_opportunities_updated'
  ) then
    create trigger trg_opportunities_updated
      before update on public.opportunities
      for each row execute function set_updated_at();
  end if;
end $$;

-- The activity timeline. Stage moves are written here automatically by the
-- server action, so history is a byproduct of working the board rather than
-- something anyone has to maintain. This is the schema's first general-purpose
-- event log; every existing "_log" table is a send-once dedupe key, not a story.
create table if not exists public.opportunity_events (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  -- 'created' | 'note' | 'call' | 'email' | 'meeting' | 'stage' | 'won' | 'lost'
  kind           text not null default 'note',
  body           text,
  from_stage     text,
  to_stage       text,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists opportunity_events_timeline_idx
  on public.opportunity_events (opportunity_id, created_at desc);

-- RLS. Both tables are admin-only in every direction: an advertiser must never
-- see that they are a row on a sales board, and a host must never see what the
-- pitch is worth. Territory scoping reuses admin_can_territory() so a
-- territory-scoped admin sees only their own market, exactly like venues and
-- campaigns.
alter table public.opportunities enable row level security;
alter table public.opportunity_events enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'opportunities'
      and policyname = 'opportunities_admin'
  ) then
    create policy opportunities_admin on public.opportunities
      for all to authenticated
      using (admin_can_territory(territory_id))
      with check (admin_can_territory(territory_id));
  end if;
end $$;

-- Events carry no territory of their own; they inherit it from their parent.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'opportunity_events'
      and policyname = 'opportunity_events_admin'
  ) then
    create policy opportunity_events_admin on public.opportunity_events
      for all to authenticated
      using (
        exists (
          select 1 from public.opportunities o
          where o.id = opportunity_events.opportunity_id
            and admin_can_territory(o.territory_id)
        )
      )
      with check (
        exists (
          select 1 from public.opportunities o
          where o.id = opportunity_events.opportunity_id
            and admin_can_territory(o.territory_id)
        )
      );
  end if;
end $$;

-- Conversations, templates, and automations.
--
-- The pipeline (0068) gave the admin a board. This gives it the thing GoHighLevel
-- is actually used for every day: messaging a prospect from their record, and
-- rules that chase people when nobody remembers to.
--
-- Four tables, in one migration on purpose — applying these by hand is a manual
-- paste into the Supabase SQL editor, and four interruptions is three too many.
--
-- SMS is modelled but not yet wired: there is no Twilio account on this app. The
-- channel column already allows 'sms' so turning it on later is configuration,
-- not a migration.

-- ---------------------------------------------------------------------------
-- messages — one row per thing sent to or received from a prospect.
-- ---------------------------------------------------------------------------

create table if not exists public.messages (
  id             uuid primary key default gen_random_uuid(),
  -- A message hangs off an opportunity, an advertiser account, or both once a
  -- prospect converts. At least one is required (see the check below), so a
  -- message can never end up belonging to nobody.
  opportunity_id uuid references public.opportunities (id) on delete cascade,
  advertiser_id  uuid references public.profiles (id) on delete cascade,
  territory_id   uuid not null references public.territories (id) on delete restrict,

  channel        text not null default 'email' check (channel in ('email', 'sms')),
  direction      text not null default 'out' check (direction in ('out', 'in')),

  to_address     text,
  from_address   text,
  subject        text,
  body           text not null,

  -- 'queued' exists so a send that fails is still visible in the thread rather
  -- than vanishing. A failed message keeps its error for exactly that reason.
  status         text not null default 'sent'
                 check (status in ('queued', 'sent', 'failed', 'received')),
  provider       text,
  provider_id    text,
  error          text,
  template_key   text,

  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint messages_has_owner check (opportunity_id is not null or advertiser_id is not null)
);

create index if not exists messages_opportunity_idx
  on public.messages (opportunity_id, created_at desc);
create index if not exists messages_advertiser_idx
  on public.messages (advertiser_id, created_at desc);
-- Inbound matching: when a reply arrives we look the sender up by address.
create index if not exists messages_to_address_idx on public.messages (to_address);

-- ---------------------------------------------------------------------------
-- message_templates — the openers you send over and over.
--
-- Body supports {business} {contact} {city} {first_name} {my_name} substitution.
-- Kept in a table rather than in code because this is sales copy: it gets edited
-- between calls, not between deploys.
-- ---------------------------------------------------------------------------

create table if not exists public.message_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  channel    text not null default 'email' check (channel in ('email', 'sms')),
  -- 'advertiser' | 'host' | 'any' — which board it is offered on.
  audience   text not null default 'any' check (audience in ('advertiser', 'host', 'any')),
  subject    text,
  body       text not null,
  active     boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_message_templates_updated') then
    create trigger trg_message_templates_updated
      before update on public.message_templates
      for each row execute function set_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- automations — "when X, do Y", evaluated once a day.
--
-- Deliberately NOT a general workflow builder. Four triggers and three actions
-- covers the chasing a two-person sales operation actually forgets to do, and a
-- node-graph editor would be a product in its own right.
--
-- Runs inside the existing daily cron: Vercel Hobby caps this project at three
-- cron jobs and all three are in use, and adding a fourth silently breaks every
-- future deploy.
-- ---------------------------------------------------------------------------

create table if not exists public.automations (
  id           uuid primary key default gen_random_uuid(),
  territory_id uuid references public.territories (id) on delete cascade,
  name         text not null,
  enabled      boolean not null default true,

  -- Which board it watches. null = both.
  kind         text check (kind is null or kind in ('advertiser', 'host')),

  -- 'stage_stale'   sitting in `stage` for `days` with no activity
  -- 'no_next_step'  open, no follow-up set, for `days`
  -- 'won'           fires once when a deal is won
  -- 'lost'          fires once when a deal is lost
  trigger      text not null check (trigger in ('stage_stale', 'no_next_step', 'won', 'lost')),
  stage        text,
  days         integer check (days is null or days > 0),

  -- 'set_next_step'  give it a follow-up dated today so it lands in Today
  -- 'log_note'       write a timeline entry
  -- 'send_email'     send a template to the contact
  action       text not null check (action in ('set_next_step', 'log_note', 'send_email')),
  action_text  text,
  template_id  uuid references public.message_templates (id) on delete set null,

  last_run_at  timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_automations_updated') then
    create trigger trg_automations_updated
      before update on public.automations
      for each row execute function set_updated_at();
  end if;
end $$;

-- One row per (automation, opportunity) that has fired. The unique constraint IS
-- the idempotency guarantee: without it a daily "chase anything stale" rule would
-- re-fire every single morning and bury the Today queue in duplicates.
create table if not exists public.automation_runs (
  automation_id  uuid not null references public.automations (id) on delete cascade,
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  fired_at       timestamptz not null default now(),
  primary key (automation_id, opportunity_id)
);

-- ---------------------------------------------------------------------------
-- RLS. All three are admin-only: an advertiser must never read the sales thread
-- about them, and a host must never see what the pitch is worth. Territory
-- scoping reuses admin_can_territory(), same as venues and campaigns.
-- ---------------------------------------------------------------------------

alter table public.messages enable row level security;
alter table public.message_templates enable row level security;
alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'messages' and policyname = 'messages_admin'
  ) then
    create policy messages_admin on public.messages
      for all to authenticated
      using (admin_can_territory(territory_id))
      with check (admin_can_territory(territory_id));
  end if;
end $$;

-- Templates are copy, not customer data, and are shared across markets.
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'message_templates' and policyname = 'message_templates_admin'
  ) then
    create policy message_templates_admin on public.message_templates
      for all to authenticated using (is_admin()) with check (is_admin());
  end if;
end $$;

-- territory_id is nullable here (null = every market), so a null must be visible
-- to any admin rather than failing the territory check.
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'automations' and policyname = 'automations_admin'
  ) then
    create policy automations_admin on public.automations
      for all to authenticated
      using (territory_id is null and is_admin() or admin_can_territory(territory_id))
      with check (territory_id is null and is_admin() or admin_can_territory(territory_id));
  end if;
end $$;

-- The run log is written only by the cron (service role); admins may read it so
-- the UI can say when a rule last fired.
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'automation_runs' and policyname = 'automation_runs_admin_read'
  ) then
    create policy automation_runs_admin_read on public.automation_runs
      for select to authenticated using (is_admin());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Seed a few templates so the compose box is useful on day one.
--
-- Copy rule (Jacob's): NO em or en dashes in anything sent to a customer.
-- The audit framing rather than a feature pitch is deliberate too.
-- ---------------------------------------------------------------------------

insert into public.message_templates (name, channel, audience, subject, body)
select * from (values
  (
    'Advertiser: first touch',
    'email', 'advertiser',
    'Quick question about {business}',
    E'Hi {contact},\n\nI run Loop Network, the screens you have probably seen inside bars and restaurants around {city}.\n\nI put together a short read on how {business} shows up to the people already walking past those screens every week. Happy to send it over, no cost either way.\n\nWorth a look?\n\n{my_name}'
  ),
  (
    'Advertiser: follow up, no reply',
    'email', 'advertiser',
    'Following up for {business}',
    E'Hi {contact},\n\nCircling back on this. The short version is that your ad would run on our screens in {city} for a flat monthly rate, and you would get a report every month showing what it actually did.\n\nIf the timing is wrong just say so and I will leave it alone.\n\n{my_name}'
  ),
  (
    'Host: first touch',
    'email', 'host',
    'A screen for {business}, at no cost to you',
    E'Hi {contact},\n\nI run Loop Network. We install a TV in local venues at no cost, run local business ads on it, and you keep free promo time for {business} on your own screen.\n\nNo contract on your side and nothing to buy. Worth ten minutes?\n\n{my_name}'
  ),
  (
    'Won: welcome',
    'email', 'advertiser',
    'Welcome to Loop Network, {business}',
    E'Hi {contact},\n\nYou are all set. Here is what happens next.\n\nI will build your spot and send it to you for approval before anything goes on screen. Once you approve it, it starts running and you will get a report each month showing scans and screen time.\n\nAny questions, just reply here.\n\n{my_name}'
  )
) as seed(name, channel, audience, subject, body)
where not exists (select 1 from public.message_templates);

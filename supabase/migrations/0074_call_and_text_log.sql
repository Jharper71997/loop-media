-- 0074_call_and_text_log.sql
-- Every call and text, in the same thread as the emails.
--
-- The admin could send an email and log it (0069). It had no idea a call had
-- ever happened. "When did we last speak to Bradley" was answerable only from
-- memory, and the call list could tell you who to ring but never that you had
-- already rung them.
--
-- Calls and texts happen on Quo (formerly OpenPhone), on a real business number,
-- from a real phone app. Quo posts a webhook for each one and we record it here.
-- Nothing has to be remembered or clicked: a call made from a phone in a car
-- lands on the same thread as an email sent from the admin.
--
-- WHY THIS EXTENDS `messages` RATHER THAN ADDING A `calls` TABLE:
-- The question being asked is "what has passed between us and this business",
-- and that is one timeline. Two tables would mean every reader — the thread, the
-- call list's last-touch, any future report — merges them by hand and eventually
-- one of them forgets to. A call is a message whose body is what happened.
--
-- Re-runnable: guarded throughout.

-- ---------------------------------------------------------------------------
-- 1. A message can now be a call.
-- ---------------------------------------------------------------------------
alter table public.messages drop constraint if exists messages_channel_check;
alter table public.messages
  add constraint messages_channel_check check (channel in ('email', 'sms', 'call'));

-- ---------------------------------------------------------------------------
-- 2. What a call needs that a message does not.
-- ---------------------------------------------------------------------------
alter table public.messages add column if not exists duration_seconds integer
  check (duration_seconds is null or duration_seconds >= 0);
-- Explicitly three-valued: true = picked up, false = rang out or was missed,
-- null = not a call. A missed call is one of the more useful rows on the
-- timeline, so it must be storable rather than merely absent.
alter table public.messages add column if not exists answered boolean;

-- The other end, in E.164. This is how a webhook finds its way to a record: Quo
-- knows a phone number and nothing about our opportunities or profiles.
alter table public.messages add column if not exists contact_phone text;

-- The provider's own payload, kept verbatim. Their schema is documented but not
-- exhaustively, and the alternative to keeping this is discovering a year from
-- now that a field we never parsed was the one that mattered. Cheap insurance.
alter table public.messages add column if not exists raw jsonb;

-- ---------------------------------------------------------------------------
-- 3. An event may arrive before we know whose it is.
-- ---------------------------------------------------------------------------
-- The old constraint demanded an opportunity or an advertiser. An inbound call
-- from a number we have never seen has neither — and that call is a LEAD, the
-- single most valuable row this table can hold. Dropping it on the floor to
-- satisfy a constraint would be exactly backwards, so a phone number is now
-- enough to own a row.
alter table public.messages drop constraint if exists messages_has_owner;
alter table public.messages
  add constraint messages_has_owner check (
    opportunity_id is not null or advertiser_id is not null or contact_phone is not null
  );

-- ---------------------------------------------------------------------------
-- 4. Webhooks retry. Idempotency is not optional.
-- ---------------------------------------------------------------------------
-- Quo redelivers on any non-2xx, and a call that ends up in the timeline three
-- times is worse than one that is missing: it makes the record untrustworthy.
-- (provider, provider_id) is the provider's own id for the event, so a retry
-- collides with the row it already wrote and updates it instead.
--
-- NOT partial, for a reason worth writing down: PostgREST's upsert sends a plain
-- `on_conflict=provider,provider_id`, and Postgres can only infer a PARTIAL
-- unique index when the statement repeats the index predicate in an
-- `ON CONFLICT ... WHERE` clause — which PostgREST has no way to express. A
-- partial index here would make every webhook fail with "no unique or exclusion
-- constraint matching the ON CONFLICT specification".
--
-- A plain index is also simply correct: Postgres treats NULLs as DISTINCT in a
-- unique index by default, so the hand-written and email rows that have no
-- provider_id do not collide with each other or with anything else.
create unique index if not exists messages_provider_event_idx
  on public.messages (provider, provider_id);

-- Finding a contact's history by number, which is what every webhook does first.
create index if not exists messages_contact_phone_idx
  on public.messages (contact_phone)
  where contact_phone is not null;

-- The timeline query: newest first for one party.
create index if not exists messages_opportunity_created_idx
  on public.messages (opportunity_id, created_at desc)
  where opportunity_id is not null;
create index if not exists messages_advertiser_created_idx
  on public.messages (advertiser_id, created_at desc)
  where advertiser_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Numbers we can match against.
-- ---------------------------------------------------------------------------
-- Matching is done on the last ten digits, because the same business is written
-- as (910) 555-0134, 910-555-0134 and +19105550134 across three tables. Storing
-- a normalised copy means the webhook does an indexed lookup instead of pulling
-- every prospect and comparing in JS.
alter table public.opportunities add column if not exists phone_e164 text;
alter table public.profiles      add column if not exists phone_e164 text;

create index if not exists opportunities_phone_e164_idx on public.opportunities (phone_e164)
  where phone_e164 is not null;
create index if not exists profiles_phone_e164_idx on public.profiles (phone_e164)
  where phone_e164 is not null;

-- Keep them in step with whatever a human typed, in the database rather than in
-- app code — the phone column is written from half a dozen places (the pipeline
-- dialog, venue editing, signup, imports) and a trigger cannot be forgotten by
-- one of them.
create or replace function public.normalize_phone_e164() returns trigger
language plpgsql as $$
declare digits text;
begin
  digits := regexp_replace(coalesce(new.phone, ''), '\D', '', 'g');
  -- Keep the last ten. A leading 1 on a US number is a country code, not area.
  if length(digits) >= 10 then
    new.phone_e164 := right(digits, 10);
  else
    new.phone_e164 := null;
  end if;
  return new;
end $$;

drop trigger if exists opportunities_phone_e164 on public.opportunities;
create trigger opportunities_phone_e164
  before insert or update of phone on public.opportunities
  for each row execute function public.normalize_phone_e164();

drop trigger if exists profiles_phone_e164 on public.profiles;
create trigger profiles_phone_e164
  before insert or update of phone on public.profiles
  for each row execute function public.normalize_phone_e164();

-- Backfill what is already there.
update public.opportunities
  set phone_e164 = right(regexp_replace(phone, '\D', '', 'g'), 10)
  where phone is not null
    and length(regexp_replace(phone, '\D', '', 'g')) >= 10
    and phone_e164 is distinct from right(regexp_replace(phone, '\D', '', 'g'), 10);

update public.profiles
  set phone_e164 = right(regexp_replace(phone, '\D', '', 'g'), 10)
  where phone is not null
    and length(regexp_replace(phone, '\D', '', 'g')) >= 10
    and phone_e164 is distinct from right(regexp_replace(phone, '\D', '', 'g'), 10);

-- ---------------------------------------------------------------------------
-- 6. Unmatched events have to be visible, not silently swallowed.
-- ---------------------------------------------------------------------------
-- A call from a number belonging to nobody is either a lead or a contact whose
-- number we have recorded differently. Both are worth seeing, and neither is
-- findable if the only way in is through a record it is not attached to.
create index if not exists messages_unmatched_idx
  on public.messages (created_at desc)
  where opportunity_id is null and advertiser_id is null;

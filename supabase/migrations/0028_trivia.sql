-- Phone trivia game tied to the TV (no DO blocks, so it runs in the SQL editor).
--
-- People scan a code on the screen, answer time-synced trivia on their phones,
-- and the leaderboard renders on the TV. Rounds derive from the wall clock (no
-- server tick): a round is a fixed window and the live question is
-- questions[round % count]. Gameplay writes go through service-role
-- /api/trivia/* routes, so these tables stay locked under RLS.

-- Per-venue join code shown on the TV (scan -> /play/<code>).
alter table venues add column if not exists play_code text unique;

update venues v
set play_code = (
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1),
    '' order by g
  )
  from generate_series(1, 4) g
  where v.id is not null
)
where play_code is null;

create table if not exists trivia_questions (
  id          uuid primary key default gen_random_uuid(),
  prompt      text not null,
  choices     jsonb not null,                       -- array of 4 strings
  correct_idx int  not null check (correct_idx between 0 and 3),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists trivia_players (
  id         uuid primary key default gen_random_uuid(),
  venue_id   uuid not null references venues(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_trivia_players_venue on trivia_players(venue_id);

create table if not exists trivia_answers (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references trivia_players(id) on delete cascade,
  venue_id   uuid not null references venues(id) on delete cascade,
  round      bigint not null,
  choice_idx int not null,
  is_correct boolean not null,
  created_at timestamptz not null default now(),
  unique (player_id, round)
);
create index if not exists idx_trivia_answers_venue on trivia_answers(venue_id, created_at);

alter table trivia_questions enable row level security;
alter table trivia_players  enable row level security;
alter table trivia_answers  enable row level security;

-- Only admins touch these directly; gameplay uses the service role via the API.
drop policy if exists trivia_questions_admin on trivia_questions;
create policy trivia_questions_admin on trivia_questions
  for all to authenticated using (is_admin()) with check (is_admin());

-- Starter question pool (only seeds an empty table, so re-running is safe).
insert into trivia_questions (prompt, choices, correct_idx)
select prompt, choices::jsonb, correct_idx
from (values
  ('Which planet is the largest in our solar system?', '["Mars","Jupiter","Saturn","Earth"]', 1),
  ('How many continents are there on Earth?', '["Five","Six","Seven","Eight"]', 2),
  ('What is the chemical symbol for gold?', '["Go","Gd","Au","Ag"]', 2),
  ('In which country is the Eiffel Tower?', '["Italy","Spain","France","Germany"]', 2),
  ('How many strings does a standard guitar have?', '["Four","Five","Six","Seven"]', 2),
  ('What is the tallest animal in the world?', '["Elephant","Giraffe","Horse","Camel"]', 1),
  ('Which ocean is the largest?', '["Atlantic","Indian","Arctic","Pacific"]', 3),
  ('In what year did the first iPhone launch?', '["2005","2007","2009","2010"]', 1),
  ('What gas do plants mainly absorb from the air?', '["Oxygen","Nitrogen","Carbon dioxide","Hydrogen"]', 2),
  ('How many minutes are in a full day?', '["1440","1240","960","2400"]', 0)
) as v(prompt, choices, correct_idx)
where not exists (select 1 from trivia_questions);

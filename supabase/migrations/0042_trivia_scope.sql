-- Loop Network — local trivia scoping.
--
-- Trivia questions were global (every screen showed the same fixed-order set). This
-- lets a question be scoped to a territory or a single venue so a market (or a
-- specific bar) can run local questions. Null on both = global (the default, and
-- what every existing seed row stays). The live state route filters by the polling
-- venue's territory/id and shuffles per day (app/api/trivia/state/route.ts).
--
-- Apply via the Supabase SQL editor or scripts/apply-migrations.js, in order.

alter table trivia_questions add column if not exists territory_id uuid references territories(id) on delete cascade;
alter table trivia_questions add column if not exists venue_id     uuid references venues(id)       on delete cascade;

create index if not exists trivia_questions_scope on trivia_questions (territory_id, venue_id);

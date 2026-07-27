-- Loop Network — speed scoring for phone trivia.
--
-- Trivia scored by STREAK (correct in a row, one miss back to zero). That model
-- gave nobody a reason to answer fast, and a miss on the second question meant a
-- player was out of contention for the night. Buzztime/Buffalo Wild Wings score by
-- SPEED instead — a question is worth up to 1,000 points and decays every second
-- it sits unanswered, with no penalty for a wrong guess. This column stores what
-- each answer actually banked, computed server-side from the round clock in
-- app/api/trivia/answer/route.ts (never from anything the phone sends).
--
-- Existing rows get 0. The leaderboard window is weekly, so nothing needs a
-- backfill — last week's board is already gone.
--
-- Apply via the Supabase SQL editor or scripts/run-sql.js.

alter table trivia_answers add column if not exists points int not null default 0;

-- The leaderboard sums points per player over the week for one venue.
create index if not exists idx_trivia_answers_points
  on trivia_answers (venue_id, created_at, player_id);

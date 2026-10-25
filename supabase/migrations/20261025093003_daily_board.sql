-- migration: daily_board
-- TouchLine online layer, Phase 1, part 3 of 6: the global Daily leaderboard and the all-time Daily totals.
-- Clients never write here. The Edge Function replays each submission with the engine on the data version it
-- was played on and inserts the figures the replay produced. Entries live in private (no user id, pick or
-- XI is ever readable by another player); the board is served by functions that copy the poster's display
-- name and country, rank by first post on ties, and reveal picks and XIs only once the day can no longer be
-- posted (00:00 UTC two days after the puzzle date). Every board takes an optional country (ISO 3166-1 alpha-2):
-- with it, rows, positions and counts are that country's only.

create table if not exists public.daily_puzzles (
  puzzle_date date primary key,
  seed text not null unique,
  -- the game settings everyone plays that day, without the team name (mode, seed, formationId, leagueId,
  -- wheelLeagues, hostClubId, leagueSeason, rules, jobSecurity, difficulty, continental, ...)
  settings jsonb not null check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 4096),
  settings_hash text not null check (char_length(settings_hash) between 1 and 32),
  engine_version text not null check (char_length(engine_version) between 1 and 16),
  data_version text not null check (char_length(data_version) between 1 and 40),
  created_at timestamptz not null default now(),
  constraint daily_puzzles_seed_matches_date check (seed = 'daily-' || to_char(puzzle_date, 'YYYY-MM-DD'))
);
comment on table public.daily_puzzles is 'The pinned Daily of each UTC day, computed by the Edge Function from the data the live site served at the first ranked request of the day. Never edited.';
alter table public.daily_puzzles enable row level security;
-- the project's default privileges grant every new public table to anon and authenticated: start from nothing
revoke all on public.daily_puzzles from public, anon, authenticated;
grant select on public.daily_puzzles to anon, authenticated;
grant select, insert on public.daily_puzzles to service_role;
create policy daily_puzzles_public_read on public.daily_puzzles for select to anon, authenticated
using (true);

create table if not exists private.daily_entries (
  id bigint generated always as identity primary key,
  puzzle_date date not null references public.daily_puzzles (puzzle_date) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  -- the poster's country when the entry was posted (a copy, like the name)
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  team_name text not null check (char_length(team_name) between 1 and 28 and team_name !~ '[[:cntrl:]]'),
  points smallint not null,
  won smallint not null check (won >= 0),
  drawn smallint not null check (drawn >= 0),
  lost smallint not null check (lost >= 0),
  goals_for smallint not null check (goals_for >= 0),
  goals_against smallint not null check (goals_against >= 0),
  goal_diff smallint generated always as (goals_for - goals_against) stored,
  league_position smallint not null check (league_position between 1 and 24),
  tier text not null check (tier in ('PERFECT', 'INVINCIBLE', 'CHAMPIONS', 'TITLE_RACE', 'EUROPEAN', 'MID_TABLE', 'RELEGATION_BATTLE', 'RELEGATED')),
  -- the submission as posted: the base64url ChallengePayload, so any row can be raced as a ghost draft later
  payload text not null check (char_length(payload) between 40 and 8000 and payload ~ '^[A-Za-z0-9_-]+$'),
  xi text[] not null check (cardinality(xi) between 11 and 18),
  history_key text not null check (char_length(history_key) between 1 and 16),
  draft_fingerprint text not null check (char_length(draft_fingerprint) between 1 and 32),
  -- whether the poster's own figures equalled the server's replay (false = a doctored claim or a browser
  -- whose Math.log/cos/exp differ from V8); kept private, it is the cross-engine divergence counter
  claim_matched boolean not null,
  engine_version text not null check (char_length(engine_version) between 1 and 16),
  data_version text not null check (char_length(data_version) between 1 and 40),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (puzzle_date, user_id),
  -- 34 or 38 games today; 42 once the 22-club Premier League seasons (1992-93 to 1994-95) join the rotation
  constraint daily_entries_figures check (won + drawn + lost between 30 and 46 and points = 3 * won + drawn)
);
create index if not exists daily_entries_board_idx
  on private.daily_entries (puzzle_date, points desc, lost, goal_diff desc, goals_for desc, created_at, id)
  where not hidden;
create index if not exists daily_entries_country_board_idx
  on private.daily_entries (puzzle_date, country, points desc, lost, goal_diff desc, goals_for desc, created_at, id)
  where not hidden;
create index if not exists daily_entries_user_idx on private.daily_entries (user_id, puzzle_date desc);
create index if not exists daily_entries_fingerprint_idx on private.daily_entries (puzzle_date, draft_fingerprint);
alter table private.daily_entries enable row level security;
revoke all on private.daily_entries from public, anon, authenticated;
grant select, insert, update on private.daily_entries to service_role;

-- All-time Daily totals, one row per account that has a visible entry: the sum of verified points, dailies
-- played, the longest run of consecutive puzzle dates and the run ending at the last one. Rebuilt from that
-- account's entries by daily_totals_refresh after every submission (and after an entry is hidden), so it never
-- drifts from the entries. Name and country are those of the account's latest entry.
create table if not exists private.daily_totals (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  total_points integer not null check (total_points >= 0),
  played integer not null check (played >= 1),
  best_streak integer not null check (best_streak >= 1),
  last_streak integer not null check (last_streak >= 1),
  last_date date not null,
  -- when the account first reached its current total: ties go to whoever got there first
  reached_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists daily_totals_points_idx on private.daily_totals (total_points desc, played, reached_at, user_id);
create index if not exists daily_totals_streak_idx on private.daily_totals (best_streak desc, total_points desc, reached_at, user_id);
create index if not exists daily_totals_country_idx on private.daily_totals (country, total_points desc);
alter table private.daily_totals enable row level security;
revoke all on private.daily_totals from public, anon, authenticated;
grant select, insert, update, delete on private.daily_totals to service_role;

-- Posts are accepted for today and yesterday (UTC): a Daily started at 23:50 may finish after midnight.
create or replace function private.daily_is_open(p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_date between (now() at time zone 'UTC')::date - 1 and (now() at time zone 'UTC')::date
$$;
revoke execute on function private.daily_is_open(date) from public;
grant execute on function private.daily_is_open(date) to anon, authenticated, service_role;

-- Picks, XIs and payloads become public once nobody can post that day any more.
create or replace function private.daily_revealed(p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select now() >= ((p_date + 2)::timestamp at time zone 'UTC')
$$;
revoke execute on function private.daily_revealed(date) from public;
grant execute on function private.daily_revealed(date) to anon, authenticated, service_role;

-- A country filter as typed: upper case, null for none; anything that is not two letters matches nobody.
create or replace function private.country_filter(p_country text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_country is null or btrim(p_country) = '' then null else upper(btrim(p_country)) end
$$;
revoke execute on function private.country_filter(text) from public;
grant execute on function private.country_filter(text) to anon, authenticated, service_role;

-- Board order: points, fewer defeats, goal difference, goals scored, then first posted. Every row has its
-- own position, so a copy of the leader's run always ranks below the original. With a country, the position
-- among that country's entries.
create or replace function private.daily_position(p_entry_id bigint, p_country text default null)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) + 1
  from private.daily_entries e, private.daily_entries me
  where me.id = p_entry_id
    and e.puzzle_date = me.puzzle_date
    and not e.hidden
    and e.id <> me.id
    and (private.country_filter(p_country) is null or e.country = private.country_filter(p_country))
    and (-e.points, e.lost, -e.goal_diff, -e.goals_for, e.created_at, e.id)
      < (-me.points, me.lost, -me.goal_diff, -me.goals_for, me.created_at, me.id)
$$;
revoke execute on function private.daily_position(bigint, text) from public, anon, authenticated;
grant execute on function private.daily_position(bigint, text) to service_role;

-- Rebuild one account's all-time totals from its visible entries (gaps and islands over the puzzle dates).
create or replace function private.daily_totals_refresh(p_user uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_total integer;
  v_played integer;
  v_best integer;
  v_last_streak integer;
  v_last date;
  v_name text;
  v_country text;
  v_reached timestamptz;
begin
  select coalesce(sum(e.points), 0), count(*), max(e.puzzle_date), max(e.created_at)
    into v_total, v_played, v_last, v_reached
  from private.daily_entries e where e.user_id = p_user and not e.hidden;
  if v_played = 0 then
    delete from private.daily_totals t where t.user_id = p_user;
    return;
  end if;
  with d as (
    select e.puzzle_date, e.puzzle_date - (row_number() over (order by e.puzzle_date))::integer as island
    from private.daily_entries e where e.user_id = p_user and not e.hidden
  ), runs as (
    select count(*)::integer as len, max(d.puzzle_date) as ends from d group by d.island
  )
  select max(r.len), max(r.len) filter (where r.ends = v_last) into v_best, v_last_streak from runs r;
  select e.display_name, e.country into v_name, v_country
  from private.daily_entries e where e.user_id = p_user and not e.hidden
  order by e.puzzle_date desc, e.created_at desc limit 1;
  insert into private.daily_totals as t (user_id, display_name, country, total_points, played, best_streak, last_streak, last_date, reached_at, updated_at)
  values (p_user, v_name, v_country, v_total, v_played, v_best, v_last_streak, v_last, v_reached, now())
  on conflict (user_id) do update set
    display_name = excluded.display_name, country = excluded.country, total_points = excluded.total_points,
    played = excluded.played, best_streak = excluded.best_streak, last_streak = excluded.last_streak,
    last_date = excluded.last_date,
    -- the time the total changed, kept when a refresh finds the same total
    reached_at = case when t.total_points = excluded.total_points then t.reached_at else excluded.reached_at end,
    updated_at = now();
end;
$$;
revoke execute on function private.daily_totals_refresh(uuid) from public, anon, authenticated;
grant execute on function private.daily_totals_refresh(uuid) to service_role;

-- ------------------------------------------------- service-only writers

-- Pin a day's puzzle once; later calls return the pinned row unchanged whatever they pass.
create or replace function public.svc_daily_pin(p_date date, p_settings jsonb, p_settings_hash text, p_engine text, p_data text)
returns public.daily_puzzles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v public.daily_puzzles%rowtype;
begin
  insert into public.daily_puzzles (puzzle_date, seed, settings, settings_hash, engine_version, data_version)
  values (p_date, 'daily-' || to_char(p_date, 'YYYY-MM-DD'), p_settings, p_settings_hash, p_engine, p_data)
  on conflict (puzzle_date) do nothing;
  select * into v from public.daily_puzzles d where d.puzzle_date = p_date;
  return v;
end;
$$;
revoke execute on function public.svc_daily_pin(date, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.svc_daily_pin(date, jsonb, text, text, text) to service_role;

-- Insert a verified entry (figures from the server's replay). The first entry per account per day stands:
-- the same draft sent again is 'duplicate' (a safe retry), a different one 'already_submitted'. The poster's
-- display name and country are copied onto the row, and the account's all-time totals are rebuilt.
create or replace function public.svc_daily_submit(p_user uuid, p_date date, p_entry jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v private.daily_entries%rowtype;
  v_status text := 'ranked';
  v_name text;
  v_country text;
begin
  if not private.daily_is_open(p_date) then
    return jsonb_build_object('status', 'closed');
  end if;
  if not exists (select 1 from public.daily_puzzles d where d.puzzle_date = p_date) then
    return jsonb_build_object('status', 'no_puzzle');
  end if;
  select * into v from private.daily_entries e where e.puzzle_date = p_date and e.user_id = p_user;
  if not found then
    v_name := private.ensure_display_name(p_user);
    select p.country into v_country from public.profiles p where p.user_id = p_user;
    insert into private.daily_entries (
      puzzle_date, user_id, display_name, country, team_name, points, won, drawn, lost, goals_for, goals_against,
      league_position, tier, payload, xi, history_key, draft_fingerprint, claim_matched, engine_version, data_version)
    values (
      p_date, p_user, v_name, v_country, p_entry ->> 'team_name', (p_entry ->> 'points')::smallint, (p_entry ->> 'won')::smallint,
      (p_entry ->> 'drawn')::smallint, (p_entry ->> 'lost')::smallint, (p_entry ->> 'goals_for')::smallint,
      (p_entry ->> 'goals_against')::smallint, (p_entry ->> 'league_position')::smallint, p_entry ->> 'tier',
      p_entry ->> 'payload', array(select jsonb_array_elements_text(p_entry -> 'xi')), p_entry ->> 'history_key',
      p_entry ->> 'draft_fingerprint', (p_entry ->> 'claim_matched')::boolean, p_entry ->> 'engine_version',
      p_entry ->> 'data_version')
    on conflict (puzzle_date, user_id) do nothing
    returning * into v;
    if not found then
      select * into v from private.daily_entries e where e.puzzle_date = p_date and e.user_id = p_user;
      v_status := 'race';
    else
      perform private.daily_totals_refresh(p_user);
    end if;
  else
    v_status := 'existing';
  end if;
  if v_status <> 'ranked' then
    v_status := case when v.draft_fingerprint = p_entry ->> 'draft_fingerprint' then 'duplicate' else 'already_submitted' end;
  end if;
  return jsonb_build_object(
    'status', v_status,
    'entryId', v.id,
    'position', private.daily_position(v.id),
    'total', (select count(*) from private.daily_entries e where e.puzzle_date = p_date and not e.hidden),
    'country', v.country,
    'countryPosition', case when v.country is not null then private.daily_position(v.id, v.country) end,
    'countryTotal', case when v.country is not null then (select count(*) from private.daily_entries e where e.puzzle_date = p_date and not e.hidden and e.country = v.country) end,
    'entry', jsonb_build_object('points', v.points, 'won', v.won, 'drawn', v.drawn, 'lost', v.lost,
      'goalsFor', v.goals_for, 'goalsAgainst', v.goals_against, 'leaguePosition', v.league_position, 'tier', v.tier,
      'claimMatched', v.claim_matched, 'dataVersion', v.data_version, 'createdAt', v.created_at));
end;
$$;
revoke execute on function public.svc_daily_submit(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.svc_daily_submit(uuid, date, jsonb) to service_role;

-- Rebuild an account's totals after moderation (an entry hidden or shown again).
create or replace function public.svc_daily_totals_refresh(p_user uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.daily_totals_refresh(p_user)
$$;
revoke execute on function public.svc_daily_totals_refresh(uuid) from public, anon, authenticated;
grant execute on function public.svc_daily_totals_refresh(uuid) to service_role;

-- ------------------------------------------------------- public readers

create or replace function private.daily_board_impl(p_date date, p_limit integer, p_offset integer, p_country text)
returns table (
  board_position bigint, entry_id bigint, display_name text, country text, team_name text, points smallint, won smallint,
  drawn smallint, lost smallint, goals_for smallint, goals_against smallint, goal_diff smallint,
  league_position smallint, tier text, data_version text, created_at timestamptz, is_me boolean,
  revealed boolean, payload text, xi text[])
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select private.daily_revealed(p_date) as open_book, private.country_filter(p_country) as c
  ), ranked as (
    select e.*, row_number() over (order by e.points desc, e.lost, e.goal_diff desc, e.goals_for desc, e.created_at, e.id) as pos
    from private.daily_entries e, r
    where e.puzzle_date = p_date and not e.hidden and (r.c is null or e.country = r.c)
  )
  select k.pos, k.id, k.display_name, k.country, k.team_name, k.points, k.won, k.drawn, k.lost, k.goals_for, k.goals_against,
         k.goal_diff, k.league_position, k.tier, k.data_version, k.created_at,
         k.user_id is not distinct from (select auth.uid()),
         r.open_book,
         case when r.open_book then k.payload end,
         case when r.open_book then k.xi end
  from ranked k cross join r
  order by k.pos
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000)
$$;
revoke execute on function private.daily_board_impl(date, integer, integer, text) from public;
grant execute on function private.daily_board_impl(date, integer, integer, text) to anon, authenticated, service_role;

create or replace function public.daily_board(p_date date, p_limit integer default 50, p_offset integer default 0, p_country text default null)
returns table (
  board_position bigint, entry_id bigint, display_name text, country text, team_name text, points smallint, won smallint,
  drawn smallint, lost smallint, goals_for smallint, goals_against smallint, goal_diff smallint,
  league_position smallint, tier text, data_version text, created_at timestamptz, is_me boolean,
  revealed boolean, payload text, xi text[])
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.daily_board_impl(p_date, p_limit, p_offset, p_country)
$$;
revoke execute on function public.daily_board(date, integer, integer, text) from public;
grant execute on function public.daily_board(date, integer, integer, text) to anon, authenticated, service_role;

-- One round trip for the Home card and the Summary: how many posted, the top score, and the caller's row
-- (its position among everyone, or among the country's entries when a country is given).
create or replace function private.daily_summary_impl(p_date date, p_country text)
returns table (played bigint, top_points smallint, my_entry_id bigint, my_position bigint, my_points smallint, posts_open boolean, revealed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from private.daily_entries e where e.puzzle_date = p_date and not e.hidden
            and (private.country_filter(p_country) is null or e.country = private.country_filter(p_country))),
         (select max(e.points) from private.daily_entries e where e.puzzle_date = p_date and not e.hidden
            and (private.country_filter(p_country) is null or e.country = private.country_filter(p_country))),
         me.id,
         case when me.id is not null and (private.country_filter(p_country) is null or me.country = private.country_filter(p_country))
              then private.daily_position(me.id, p_country) end,
         me.points,
         private.daily_is_open(p_date),
         private.daily_revealed(p_date)
  from (select 1) one
  left join private.daily_entries me on me.puzzle_date = p_date and me.user_id = (select auth.uid())
$$;
revoke execute on function private.daily_summary_impl(date, text) from public;
grant execute on function private.daily_summary_impl(date, text) to anon, authenticated, service_role;

create or replace function public.daily_summary(p_date date, p_country text default null)
returns table (played bigint, top_points smallint, my_entry_id bigint, my_position bigint, my_points smallint, posts_open boolean, revealed boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.daily_summary_impl(p_date, p_country)
$$;
revoke execute on function public.daily_summary(date, text) from public;
grant execute on function public.daily_summary(date, text) to anon, authenticated, service_role;

-- Where a result that is not on the board would place ("your 71 points would be 23rd"), for anyone.
create or replace function private.daily_rank_impl(p_date date, p_points integer, p_lost integer, p_goal_diff integer, p_goals_for integer, p_country text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) + 1
  from private.daily_entries e
  where e.puzzle_date = p_date and not e.hidden
    and (private.country_filter(p_country) is null or e.country = private.country_filter(p_country))
    and (-e.points, e.lost, -e.goal_diff, -e.goals_for) <= (-p_points, p_lost, -p_goal_diff, -p_goals_for)
$$;
revoke execute on function private.daily_rank_impl(date, integer, integer, integer, integer, text) from public;
grant execute on function private.daily_rank_impl(date, integer, integer, integer, integer, text) to anon, authenticated, service_role;

create or replace function public.daily_rank(p_date date, p_points integer, p_lost integer, p_goal_diff integer, p_goals_for integer, p_country text default null)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select private.daily_rank_impl(p_date, p_points, p_lost, p_goal_diff, p_goals_for, p_country)
$$;
revoke execute on function public.daily_rank(date, integer, integer, integer, integer, text) from public;
grant execute on function public.daily_rank(date, integer, integer, integer, integer, text) to anon, authenticated, service_role;

-- The caller's own entries for the Record page ("Your dailies").
create or replace function private.daily_my_entries_impl(p_limit integer)
returns table (
  puzzle_date date, entry_id bigint, board_position bigint, total bigint, points smallint, won smallint, drawn smallint,
  lost smallint, goals_for smallint, goals_against smallint, tier text, team_name text, display_name text, country text,
  claim_matched boolean, data_version text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select e.puzzle_date, e.id, private.daily_position(e.id),
         (select count(*) from private.daily_entries x where x.puzzle_date = e.puzzle_date and not x.hidden),
         e.points, e.won, e.drawn, e.lost, e.goals_for, e.goals_against, e.tier, e.team_name, e.display_name, e.country,
         e.claim_matched, e.data_version, e.created_at
  from private.daily_entries e
  where e.user_id = (select auth.uid())
  order by e.puzzle_date desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;
revoke execute on function private.daily_my_entries_impl(integer) from public, anon;
grant execute on function private.daily_my_entries_impl(integer) to authenticated;

create or replace function public.daily_my_entries(p_limit integer default 30)
returns table (
  puzzle_date date, entry_id bigint, board_position bigint, total bigint, points smallint, won smallint, drawn smallint,
  lost smallint, goals_for smallint, goals_against smallint, tier text, team_name text, display_name text, country text,
  claim_matched boolean, data_version text, created_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.daily_my_entries_impl(p_limit)
$$;
revoke execute on function public.daily_my_entries(integer) from public, anon;
grant execute on function public.daily_my_entries(integer) to authenticated;

-- ------------------------------------------------- the all-time Daily board

-- p_order 'points' (default): total verified points, then fewer dailies played, then who got there first.
-- p_order 'streak': best streak, then total points, then who got there first. current_streak is the run
-- ending at the account's last daily while it can still be extended (that day is today or yesterday, UTC).
create or replace function private.daily_alltime_impl(p_order text, p_country text, p_limit integer, p_offset integer)
returns table (
  board_position bigint, display_name text, country text, total_points integer, played integer,
  average_points numeric, best_streak integer, current_streak integer, last_date date, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select t.*, row_number() over (order by
             case when p_order = 'streak' then t.best_streak end desc nulls last,
             t.total_points desc,
             case when p_order = 'streak' then null else t.played end asc nulls last,
             t.reached_at, t.user_id) as pos
    from private.daily_totals t
    where private.country_filter(p_country) is null or t.country = private.country_filter(p_country)
  )
  select k.pos, k.display_name, k.country, k.total_points, k.played, round(k.total_points::numeric / k.played, 1),
         k.best_streak,
         case when k.last_date >= (now() at time zone 'UTC')::date - 1 then k.last_streak else 0 end,
         k.last_date,
         k.user_id is not distinct from (select auth.uid())
  from ranked k
  order by k.pos
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000)
$$;
revoke execute on function private.daily_alltime_impl(text, text, integer, integer) from public;
grant execute on function private.daily_alltime_impl(text, text, integer, integer) to anon, authenticated, service_role;

create or replace function public.daily_alltime_board(p_order text default 'points', p_country text default null, p_limit integer default 50, p_offset integer default 0)
returns table (
  board_position bigint, display_name text, country text, total_points integer, played integer,
  average_points numeric, best_streak integer, current_streak integer, last_date date, is_me boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.daily_alltime_impl(p_order, p_country, p_limit, p_offset)
$$;
revoke execute on function public.daily_alltime_board(text, text, integer, integer) from public;
grant execute on function public.daily_alltime_board(text, text, integer, integer) to anon, authenticated, service_role;

-- The caller's own all-time row with its position (worldwide, or in the given country), for the Record page.
create or replace function private.daily_alltime_mine_impl(p_order text, p_country text)
returns table (
  board_position bigint, players bigint, display_name text, country text, total_points integer, played integer,
  best_streak integer, current_streak integer, last_date date)
language sql
stable
security definer
set search_path = ''
as $$
  with pool as (
    select t.* from private.daily_totals t
    where private.country_filter(p_country) is null or t.country = private.country_filter(p_country)
  ), me as (
    select t.* from pool t where t.user_id = (select auth.uid())
  )
  select (select count(*) + 1 from pool o where
            case when p_order = 'streak'
                 then (-o.best_streak, -o.total_points, o.reached_at, o.user_id) < (-me.best_streak, -me.total_points, me.reached_at, me.user_id)
                 else (-o.total_points, o.played, o.reached_at, o.user_id) < (-me.total_points, me.played, me.reached_at, me.user_id) end),
         (select count(*) from pool),
         me.display_name, me.country, me.total_points, me.played, me.best_streak,
         case when me.last_date >= (now() at time zone 'UTC')::date - 1 then me.last_streak else 0 end,
         me.last_date
  from me
$$;
revoke execute on function private.daily_alltime_mine_impl(text, text) from public, anon;
grant execute on function private.daily_alltime_mine_impl(text, text) to authenticated;

create or replace function public.daily_alltime_mine(p_order text default 'points', p_country text default null)
returns table (
  board_position bigint, players bigint, display_name text, country text, total_points integer, played integer,
  best_streak integer, current_streak integer, last_date date)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.daily_alltime_mine_impl(p_order, p_country)
$$;
revoke execute on function public.daily_alltime_mine(text, text) from public, anon;
grant execute on function public.daily_alltime_mine(text, text) to authenticated;

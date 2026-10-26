-- migration: chase_board
-- TouchLine online layer: the 38-0 chase, Quick Draft's world leaderboard (docs/ONLINE.md section 5d).
--
-- A Quick Draft seed is the player's own choice, so a board of player-seeded seasons could be won by grinding
-- seeds offline until the wheel deals a lucky one. The chase therefore ranks only seasons played on a wheel the
-- server issued: the Edge Function's `chase.start` asks svc_chase_start for an attempt (a random 10-character code,
-- seed 'chase-<code>', the league and shape the player chose, the live engine and data), at most five attempts per
-- account per UTC day, each open for 48 hours and posted at most once (`chase.submit`, replayed by the verifier,
-- filed by svc_chase_submit). Abandoned attempts still count against the day, so a bad first spin costs a run.
--
-- Board order: points dropped against the league's maximum (3 per game, so a 34-game season ranks beside a 38-game
-- one and, within one league, this is simply points), then fewer defeats, goal difference, goals scored, first
-- posted. Each account appears once per board, with its best run: this week (the ISO week the attempt was issued
-- in) or all time, optionally for one country. A flawless season (every league game won: 38-0, or 34-0 for an
-- 18-club league) is flagged. Payloads are public at once: an attempt's seed is personal and single-use, so racing
-- a posted run (a challenge link, never ranked) cannot help anyone rank.
--
-- Same rules as every online migration: RLS on both tables with a deny-all policy for the client roles, explicit
-- grants after revoking this project's default privileges, SECURITY DEFINER only in private with a pinned
-- search_path, svc_* writers for service_role only, and anon executes only the readers chase_board and
-- chase_summary (on the allowlist in supabase/tests/sql/phase1_security.sql).

-- ------------------------------------------------------------------ attempts

create table if not exists private.chase_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{10}$'),
  league_id text not null check (league_id ~ '^[a-z][a-z0-9-]{1,30}$'),
  formation_id text not null check (formation_id ~ '^[0-9a-z-]{3,16}$'),
  engine_version text not null check (char_length(engine_version) between 1 and 16),
  data_version text not null check (char_length(data_version) between 1 and 40),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  constraint chase_attempts_window check (expires_at > created_at and expires_at <= created_at + interval '7 days')
);
comment on table private.chase_attempts is 'Server-issued 38-0 chase wheels: one row per attempt, written only by svc_chase_start, closed by svc_chase_submit.';
create index if not exists chase_attempts_user_idx on private.chase_attempts (user_id, created_at desc);
alter table private.chase_attempts enable row level security;
revoke all on private.chase_attempts from public, anon, authenticated;
grant select, insert, update on private.chase_attempts to service_role;
drop policy if exists chase_attempts_service_only on private.chase_attempts;
create policy chase_attempts_service_only on private.chase_attempts as restrictive for all to anon, authenticated using (false) with check (false);

-- ------------------------------------------------------------------- entries

create table if not exists private.chase_entries (
  id bigint generated always as identity primary key,
  attempt_id bigint not null unique references private.chase_attempts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  display_name text not null check (char_length(display_name) between 1 and 24),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  team_name text not null check (char_length(team_name) between 1 and 28 and team_name !~ '[[:cntrl:]]'),
  league_id text not null check (league_id ~ '^[a-z][a-z0-9-]{1,30}$'),
  points smallint not null,
  won smallint not null check (won >= 0),
  drawn smallint not null check (drawn >= 0),
  lost smallint not null check (lost >= 0),
  games smallint generated always as (won + drawn + lost) stored,
  goals_for smallint not null check (goals_for >= 0),
  goals_against smallint not null check (goals_against >= 0),
  goal_diff smallint generated always as (goals_for - goals_against) stored,
  dropped smallint generated always as (3 * (won + drawn + lost) - points) stored,
  perfect boolean generated always as (drawn = 0 and lost = 0) stored,
  league_position smallint not null check (league_position between 1 and 24),
  tier text not null check (tier in ('PERFECT', 'INVINCIBLE', 'CHAMPIONS', 'TITLE_RACE', 'EUROPEAN', 'MID_TABLE', 'RELEGATION_BATTLE', 'RELEGATED')),
  payload text not null check (char_length(payload) between 40 and 8000 and payload ~ '^[A-Za-z0-9_-]+$'),
  xi text[] not null check (cardinality(xi) between 11 and 18),
  history_key text not null check (char_length(history_key) between 1 and 16),
  draft_fingerprint text not null check (char_length(draft_fingerprint) between 1 and 32),
  claim_matched boolean not null,
  engine_version text not null check (char_length(engine_version) between 1 and 16),
  data_version text not null check (char_length(data_version) between 1 and 40),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  constraint chase_entries_figures check (won + drawn + lost between 10 and 46 and points = 3 * won + drawn),
  constraint chase_entries_team_name_clean check (private.is_clean_name(team_name))
);
comment on table private.chase_entries is 'Verified 38-0 chase seasons: the replay''s figures, one per attempt, written only by svc_chase_submit.';
create index if not exists chase_entries_board_idx
  on private.chase_entries (dropped, lost, goal_diff desc, goals_for desc, created_at, id) where not hidden;
create index if not exists chase_entries_week_idx
  on private.chase_entries (week_start, dropped, lost, goal_diff desc, goals_for desc, created_at, id) where not hidden;
create index if not exists chase_entries_country_idx
  on private.chase_entries (country, dropped, lost, goal_diff desc, goals_for desc, created_at, id) where not hidden;
create index if not exists chase_entries_user_idx on private.chase_entries (user_id, created_at desc);
alter table private.chase_entries enable row level security;
revoke all on private.chase_entries from public, anon, authenticated;
grant select, insert, update on private.chase_entries to service_role;
drop policy if exists chase_entries_service_only on private.chase_entries;
create policy chase_entries_service_only on private.chase_entries as restrictive for all to anon, authenticated using (false) with check (false);

-- ------------------------------------------------------------------- helpers

-- The attempts an account may start per UTC day, and how long each stays open (mirrored by CHASE_ATTEMPTS_PER_DAY
-- and CHASE_ATTEMPT_HOURS in src/online/chase.ts).
create or replace function private.chase_daily_cap()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 5
$$;
revoke execute on function private.chase_daily_cap() from public, anon, authenticated;
grant execute on function private.chase_daily_cap() to service_role;

-- The start of the current UTC day.
create or replace function private.chase_day_start()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((now() at time zone 'UTC')::date)::timestamp at time zone 'UTC'
$$;
revoke execute on function private.chase_day_start() from public, anon, authenticated;
grant execute on function private.chase_day_start() to service_role;

create or replace function private.chase_attempt_json(a private.chase_attempts)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('code', a.code, 'seed', 'chase-' || a.code, 'leagueId', a.league_id, 'formationId', a.formation_id,
    'engineVersion', a.engine_version, 'dataVersion', a.data_version, 'createdAt', a.created_at, 'expiresAt', a.expires_at,
    'submittedAt', a.submitted_at)
$$;
revoke execute on function private.chase_attempt_json(private.chase_attempts) from public, anon, authenticated;
grant execute on function private.chase_attempt_json(private.chase_attempts) to service_role;

-- An account's best visible entry on a board: this week's (p_week) or all time (null), optionally one country's.
create or replace function private.chase_best_entry(p_user uuid, p_week date, p_country text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select e.id from private.chase_entries e
  where e.user_id = p_user and not e.hidden
    and (p_week is null or e.week_start = p_week)
    and (private.country_filter(p_country) is null or e.country = private.country_filter(p_country))
  order by e.dropped, e.lost, e.goal_diff desc, e.goals_for desc, e.created_at, e.id
  limit 1
$$;
revoke execute on function private.chase_best_entry(uuid, date, text) from public, anon, authenticated;
grant execute on function private.chase_best_entry(uuid, date, text) to service_role;

-- The board position of an entry: one plus the accounts with a better visible run on the same board.
create or replace function private.chase_position(p_entry_id bigint, p_week date, p_country text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct e.user_id) + 1
  from private.chase_entries e, private.chase_entries me
  where me.id = p_entry_id
    and not e.hidden
    and e.user_id <> me.user_id
    and (p_week is null or e.week_start = p_week)
    and (private.country_filter(p_country) is null or e.country = private.country_filter(p_country))
    and (e.dropped, e.lost, -e.goal_diff, -e.goals_for, e.created_at, e.id)
      < (me.dropped, me.lost, -me.goal_diff, -me.goals_for, me.created_at, me.id)
$$;
revoke execute on function private.chase_position(bigint, date, text) from public, anon, authenticated;
grant execute on function private.chase_position(bigint, date, text) to service_role;

-- The accounts on a board.
create or replace function private.chase_players(p_week date, p_country text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct e.user_id) from private.chase_entries e
  where not e.hidden
    and (p_week is null or e.week_start = p_week)
    and (private.country_filter(p_country) is null or e.country = private.country_filter(p_country))
$$;
revoke execute on function private.chase_players(date, text) from public, anon, authenticated;
grant execute on function private.chase_players(date, text) to service_role;

-- 'week' (this ISO week, or p_week's) or 'alltime' as the week a board reads (null for all time). Called only
-- from the SECURITY DEFINER readers, so the client roles need no grant.
create or replace function private.chase_scope_week(p_scope text, p_week date)
returns date
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_scope = 'alltime' then
    return null;
  elsif p_scope = 'week' then
    return private.week_start_of(coalesce(p_week, (now() at time zone 'UTC')::date));
  end if;
  raise exception 'scope is week or alltime' using errcode = '22023';
end;
$$;
revoke execute on function private.chase_scope_week(text, date) from public, anon, authenticated;
grant execute on function private.chase_scope_week(text, date) to service_role;

-- ------------------------------------------------- service-only writers

create or replace function public.svc_chase_start(p_user uuid, p_league text, p_formation text, p_engine text, p_data text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_today integer;
  v_cap constant integer := private.chase_daily_cap();
  v_row private.chase_attempts%rowtype;
begin
  if p_user is null then
    raise exception 'no user' using errcode = '22023';
  end if;
  -- One start at a time per account, so two parallel calls cannot both take the last attempt of the day
  perform pg_advisory_xact_lock(hashtextextended('touchline-chase:' || p_user::text, 0));
  select count(*) into v_today from private.chase_attempts a where a.user_id = p_user and a.created_at >= private.chase_day_start();
  if v_today >= v_cap then
    return jsonb_build_object('status', 'limit', 'cap', v_cap, 'left', 0, 'resetsAt', private.chase_day_start() + interval '1 day');
  end if;
  for i in 1 .. 8 loop
    insert into private.chase_attempts (user_id, code, league_id, formation_id, engine_version, data_version, expires_at)
    values (p_user, private.random_code(10), p_league, p_formation, p_engine, p_data, now() + interval '48 hours')
    on conflict (code) do nothing
    returning * into v_row;
    if found then
      return jsonb_build_object('status', 'ok', 'cap', v_cap, 'left', v_cap - v_today - 1, 'resetsAt', private.chase_day_start() + interval '1 day',
        'attempt', private.chase_attempt_json(v_row));
    end if;
  end loop;
  raise exception 'could not allocate a chase code' using errcode = 'PT503';
end;
$$;
revoke execute on function public.svc_chase_start(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.svc_chase_start(uuid, text, text, text, text) to service_role;

-- The caller's own attempt by code (the verifier needs its league, shape, engine and data), or null.
create or replace function public.svc_chase_attempt(p_user uuid, p_code text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.chase_attempt_json(a) from private.chase_attempts a where a.code = p_code and a.user_id = p_user
$$;
revoke execute on function public.svc_chase_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.svc_chase_attempt(uuid, text) to service_role;

create or replace function public.svc_chase_submit(p_user uuid, p_code text, p_entry jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  a private.chase_attempts%rowtype;
  v private.chase_entries%rowtype;
  v_status text := 'ranked';
  v_name text;
  v_country text;
  v_best bigint;
  v_week_best bigint;
  v_country_best bigint;
begin
  select * into a from private.chase_attempts x where x.code = p_code and x.user_id = p_user for update;
  if not found then
    return jsonb_build_object('status', 'no_attempt');
  end if;
  select * into v from private.chase_entries e where e.attempt_id = a.id;
  if found then
    v_status := case when v.draft_fingerprint = p_entry ->> 'draft_fingerprint' then 'duplicate' else 'already_submitted' end;
  else
    if now() >= a.expires_at then
      return jsonb_build_object('status', 'closed');
    end if;
    v_name := private.ensure_display_name(p_user);
    select p.country into v_country from public.profiles p where p.user_id = p_user;
    insert into private.chase_entries (
      attempt_id, user_id, week_start, display_name, country, team_name, league_id, points, won, drawn, lost, goals_for,
      goals_against, league_position, tier, payload, xi, history_key, draft_fingerprint, claim_matched, engine_version, data_version)
    values (
      a.id, p_user, private.week_start_of((a.created_at at time zone 'UTC')::date), v_name, v_country, p_entry ->> 'team_name',
      a.league_id, (p_entry ->> 'points')::smallint, (p_entry ->> 'won')::smallint, (p_entry ->> 'drawn')::smallint,
      (p_entry ->> 'lost')::smallint, (p_entry ->> 'goals_for')::smallint, (p_entry ->> 'goals_against')::smallint,
      (p_entry ->> 'league_position')::smallint, p_entry ->> 'tier', p_entry ->> 'payload',
      array(select jsonb_array_elements_text(p_entry -> 'xi')), p_entry ->> 'history_key', p_entry ->> 'draft_fingerprint',
      (p_entry ->> 'claim_matched')::boolean, p_entry ->> 'engine_version', p_entry ->> 'data_version')
    returning * into v;
    update private.chase_attempts x set submitted_at = now() where x.id = a.id;
  end if;
  v_best := private.chase_best_entry(p_user, null, null);
  v_week_best := private.chase_best_entry(p_user, v.week_start, null);
  v_country_best := case when v.country is not null then private.chase_best_entry(p_user, null, v.country) end;
  return jsonb_build_object(
    'status', v_status,
    'entryId', v.id,
    'personalBest', v_best = v.id,
    'perfect', v.perfect,
    'games', v.games,
    'position', private.chase_position(v_best, null, null),
    'total', private.chase_players(null, null),
    'week', to_char(v.week_start, 'IYYY-"W"IW'),
    'weekPosition', private.chase_position(v_week_best, v.week_start, null),
    'weekTotal', private.chase_players(v.week_start, null),
    'country', v.country,
    'countryPosition', case when v_country_best is not null then private.chase_position(v_country_best, null, v.country) end,
    'countryTotal', case when v.country is not null then private.chase_players(null, v.country) end,
    'entry', jsonb_build_object('points', v.points, 'won', v.won, 'drawn', v.drawn, 'lost', v.lost, 'games', v.games,
      'goalsFor', v.goals_for, 'goalsAgainst', v.goals_against, 'leaguePosition', v.league_position, 'tier', v.tier,
      'perfect', v.perfect, 'claimMatched', v.claim_matched, 'dataVersion', v.data_version, 'createdAt', v.created_at));
end;
$$;
revoke execute on function public.svc_chase_submit(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.svc_chase_submit(uuid, text, jsonb) to service_role;

-- ------------------------------------------------------- public readers

create or replace function private.chase_board_impl(p_scope text, p_week date, p_limit integer, p_offset integer, p_country text)
returns table (
  board_position bigint, entry_id bigint, display_name text, country text, team_name text, league_id text, games smallint,
  points smallint, won smallint, drawn smallint, lost smallint, goals_for smallint, goals_against smallint, goal_diff smallint,
  dropped smallint, perfect boolean, league_position smallint, tier text, data_version text, created_at timestamptz,
  is_me boolean, payload text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  -- evaluated first, so a bad scope is refused even on an empty board
  v_week date := private.chase_scope_week(p_scope, p_week);
  v_country text := private.country_filter(p_country);
begin
  return query
  with best as (
    select distinct on (e.user_id) e.*
    from private.chase_entries e
    where not e.hidden and (v_week is null or e.week_start = v_week) and (v_country is null or e.country = v_country)
    order by e.user_id, e.dropped, e.lost, e.goal_diff desc, e.goals_for desc, e.created_at, e.id
  ), ranked as (
    select b.*, row_number() over (order by b.dropped, b.lost, b.goal_diff desc, b.goals_for desc, b.created_at, b.id) as pos
    from best b
  )
  select k.pos, k.id, k.display_name, k.country, k.team_name, k.league_id, k.games, k.points, k.won, k.drawn, k.lost,
         k.goals_for, k.goals_against, k.goal_diff, k.dropped, k.perfect, k.league_position, k.tier, k.data_version,
         k.created_at, k.user_id is not distinct from (select auth.uid()), k.payload
  from ranked k
  order by k.pos
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000);
end;
$$;
revoke execute on function private.chase_board_impl(text, date, integer, integer, text) from public;
grant execute on function private.chase_board_impl(text, date, integer, integer, text) to anon, authenticated, service_role;

create or replace function public.chase_board(p_scope text default 'week', p_week date default null, p_limit integer default 50, p_offset integer default 0, p_country text default null)
returns table (
  board_position bigint, entry_id bigint, display_name text, country text, team_name text, league_id text, games smallint,
  points smallint, won smallint, drawn smallint, lost smallint, goals_for smallint, goals_against smallint, goal_diff smallint,
  dropped smallint, perfect boolean, league_position smallint, tier text, data_version text, created_at timestamptz,
  is_me boolean, payload text)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.chase_board_impl(p_scope, p_week, p_limit, p_offset, p_country)
$$;
revoke execute on function public.chase_board(text, date, integer, integer, text) from public;
grant execute on function public.chase_board(text, date, integer, integer, text) to anon, authenticated, service_role;

-- A board's counts, the caller's place on it, and the closest-ever-to-perfect season (all time, same country filter).
create or replace function private.chase_summary_impl(p_scope text, p_week date, p_country text)
returns table (
  players bigint, runs bigint, flawless bigint, my_position bigint, my_points smallint, my_won smallint, my_drawn smallint,
  my_lost smallint, my_games smallint, record_display_name text, record_country text, record_team_name text,
  record_league_id text, record_games smallint, record_points smallint, record_won smallint, record_drawn smallint,
  record_lost smallint, record_goal_diff smallint, record_created_at timestamptz, record_flawless bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_week date := private.chase_scope_week(p_scope, p_week);
  v_country text := private.country_filter(p_country);
  v_mine bigint := private.chase_best_entry((select auth.uid()), private.chase_scope_week(p_scope, p_week), p_country);
begin
  return query
  with scoped as (
    select e.* from private.chase_entries e
    where not e.hidden and (v_week is null or e.week_start = v_week) and (v_country is null or e.country = v_country)
  ), everything as (
    select e.* from private.chase_entries e where not e.hidden and (v_country is null or e.country = v_country)
  ), record as (
    select x.* from everything x order by x.dropped, x.lost, x.goal_diff desc, x.goals_for desc, x.created_at, x.id limit 1
  )
  select (select count(distinct s.user_id) from scoped s),
         (select count(*) from scoped s),
         (select count(*) from scoped s where s.perfect),
         case when v_mine is not null then private.chase_position(v_mine, v_week, v_country) end,
         me.points, me.won, me.drawn, me.lost, me.games,
         rec.display_name, rec.country, rec.team_name, rec.league_id, rec.games, rec.points, rec.won, rec.drawn, rec.lost,
         rec.goal_diff, rec.created_at,
         (select count(*) from everything x where x.perfect)
  from (select 1) one
  left join private.chase_entries me on me.id = v_mine
  left join record rec on true;
end;
$$;
revoke execute on function private.chase_summary_impl(text, date, text) from public;
grant execute on function private.chase_summary_impl(text, date, text) to anon, authenticated, service_role;

create or replace function public.chase_summary(p_scope text default 'week', p_week date default null, p_country text default null)
returns table (
  players bigint, runs bigint, flawless bigint, my_position bigint, my_points smallint, my_won smallint, my_drawn smallint,
  my_lost smallint, my_games smallint, record_display_name text, record_country text, record_team_name text,
  record_league_id text, record_games smallint, record_points smallint, record_won smallint, record_drawn smallint,
  record_lost smallint, record_goal_diff smallint, record_created_at timestamptz, record_flawless bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.chase_summary_impl(p_scope, p_week, p_country)
$$;
revoke execute on function public.chase_summary(text, date, text) from public;
grant execute on function public.chase_summary(text, date, text) to anon, authenticated, service_role;

-- Signed in: today's attempts against the cap, and the caller's best season.
create or replace function private.chase_my_status_impl()
returns table (attempts_today integer, cap integer, attempts_left integer, resets_at timestamptz, runs bigint,
  best_points smallint, best_won smallint, best_drawn smallint, best_lost smallint, best_games smallint)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select count(*)::integer as n from private.chase_attempts a
    where a.user_id = (select auth.uid()) and a.created_at >= private.chase_day_start()
  ), b as (
    select e.* from private.chase_entries e where e.id = private.chase_best_entry((select auth.uid()), null, null)
  )
  select t.n, private.chase_daily_cap(), greatest(private.chase_daily_cap() - t.n, 0), private.chase_day_start() + interval '1 day',
         (select count(*) from private.chase_entries e where e.user_id = (select auth.uid())),
         b.points, b.won, b.drawn, b.lost, b.games
  from t left join b on true
  where (select auth.uid()) is not null
$$;
revoke execute on function private.chase_my_status_impl() from public, anon;
grant execute on function private.chase_my_status_impl() to authenticated;

create or replace function public.chase_my_status()
returns table (attempts_today integer, cap integer, attempts_left integer, resets_at timestamptz, runs bigint,
  best_points smallint, best_won smallint, best_drawn smallint, best_lost smallint, best_games smallint)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.chase_my_status_impl()
$$;
revoke execute on function public.chase_my_status() from public, anon;
grant execute on function public.chase_my_status() to authenticated;

create or replace function private.chase_my_entries_impl(p_limit integer)
returns table (
  entry_id bigint, code text, week_key text, league_id text, games smallint, points smallint, won smallint, drawn smallint,
  lost smallint, goals_for smallint, goals_against smallint, perfect boolean, tier text, team_name text, claim_matched boolean,
  data_version text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, a.code, to_char(e.week_start, 'IYYY-"W"IW'), e.league_id, e.games, e.points, e.won, e.drawn, e.lost,
         e.goals_for, e.goals_against, e.perfect, e.tier, e.team_name, e.claim_matched, e.data_version, e.created_at
  from private.chase_entries e join private.chase_attempts a on a.id = e.attempt_id
  where e.user_id = (select auth.uid())
  order by e.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;
revoke execute on function private.chase_my_entries_impl(integer) from public, anon;
grant execute on function private.chase_my_entries_impl(integer) to authenticated;

create or replace function public.chase_my_entries(p_limit integer default 30)
returns table (
  entry_id bigint, code text, week_key text, league_id text, games smallint, points smallint, won smallint, drawn smallint,
  lost smallint, goals_for smallint, goals_against smallint, perfect boolean, tier text, team_name text, claim_matched boolean,
  data_version text, created_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.chase_my_entries_impl(p_limit)
$$;
revoke execute on function public.chase_my_entries(integer) from public, anon;
grant execute on function public.chase_my_entries(integer) to authenticated;

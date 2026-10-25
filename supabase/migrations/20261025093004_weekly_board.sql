-- migration: weekly_board
-- TouchLine online layer, Phase 1, part 4 of 6: the weekly fixed-seed challenge, the world leaderboard's
-- other board. One puzzle per ISO week (Monday 00:00 UTC to the next Monday), seed 'weekly-YYYY-Www', settings
-- from weeklyGameSettings (src/online/weekly.ts) pinned by the Edge Function exactly as the Daily is. Entries
-- are verified by the same replay and written only by svc_weekly_submit; the first post per account per week
-- stands. Posts are accepted until 00:00 UTC on the Tuesday after the week (a one-day grace for a run started
-- late on Sunday); picks, XIs and payloads are revealed from then on. Every reader takes an optional country.

create table if not exists public.weekly_puzzles (
  week_start date primary key check (extract(isodow from week_start) = 1),
  week_key text not null unique,
  seed text not null unique,
  settings jsonb not null check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 4096),
  settings_hash text not null check (char_length(settings_hash) between 1 and 32),
  engine_version text not null check (char_length(engine_version) between 1 and 16),
  data_version text not null check (char_length(data_version) between 1 and 40),
  created_at timestamptz not null default now(),
  constraint weekly_puzzles_key_matches_week check (week_key = to_char(week_start, 'IYYY-"W"IW')),
  constraint weekly_puzzles_seed_matches_key check (seed = 'weekly-' || week_key)
);
comment on table public.weekly_puzzles is 'The pinned weekly challenge of each ISO week, computed by the Edge Function from the data the live site served at the first ranked request of the week. Never edited.';
alter table public.weekly_puzzles enable row level security;
-- the project's default privileges grant every new public table to anon and authenticated: start from nothing
revoke all on public.weekly_puzzles from public, anon, authenticated;
grant select on public.weekly_puzzles to anon, authenticated;
grant select, insert on public.weekly_puzzles to service_role;
create policy weekly_puzzles_public_read on public.weekly_puzzles for select to anon, authenticated
using (true);

create table if not exists private.weekly_entries (
  id bigint generated always as identity primary key,
  week_start date not null references public.weekly_puzzles (week_start) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
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
  payload text not null check (char_length(payload) between 40 and 8000 and payload ~ '^[A-Za-z0-9_-]+$'),
  xi text[] not null check (cardinality(xi) between 11 and 18),
  history_key text not null check (char_length(history_key) between 1 and 16),
  draft_fingerprint text not null check (char_length(draft_fingerprint) between 1 and 32),
  claim_matched boolean not null,
  engine_version text not null check (char_length(engine_version) between 1 and 16),
  data_version text not null check (char_length(data_version) between 1 and 40),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (week_start, user_id),
  constraint weekly_entries_figures check (won + drawn + lost between 30 and 46 and points = 3 * won + drawn)
);
create index if not exists weekly_entries_board_idx
  on private.weekly_entries (week_start, points desc, lost, goal_diff desc, goals_for desc, created_at, id)
  where not hidden;
create index if not exists weekly_entries_country_board_idx
  on private.weekly_entries (week_start, country, points desc, lost, goal_diff desc, goals_for desc, created_at, id)
  where not hidden;
create index if not exists weekly_entries_user_idx on private.weekly_entries (user_id, week_start desc);
create index if not exists weekly_entries_fingerprint_idx on private.weekly_entries (week_start, draft_fingerprint);
alter table private.weekly_entries enable row level security;
revoke all on private.weekly_entries from public, anon, authenticated;
grant select, insert, update on private.weekly_entries to service_role;

-- The Monday (UTC) of the ISO week holding a date.
create or replace function private.week_start_of(p_date date)
returns date
language sql
immutable
set search_path = ''
as $$
  select p_date - (extract(isodow from p_date)::integer - 1)
$$;
revoke execute on function private.week_start_of(date) from public;
grant execute on function private.week_start_of(date) to anon, authenticated, service_role;

-- Open from the Monday until the Tuesday after the week, 00:00 UTC.
create or replace function private.weekly_is_open(p_week date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select extract(isodow from p_week) = 1
     and now() >= (p_week::timestamp at time zone 'UTC')
     and now() < ((p_week + 8)::timestamp at time zone 'UTC')
$$;
revoke execute on function private.weekly_is_open(date) from public;
grant execute on function private.weekly_is_open(date) to anon, authenticated, service_role;

create or replace function private.weekly_revealed(p_week date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select now() >= ((p_week + 8)::timestamp at time zone 'UTC')
$$;
revoke execute on function private.weekly_revealed(date) from public;
grant execute on function private.weekly_revealed(date) to anon, authenticated, service_role;

create or replace function private.weekly_position(p_entry_id bigint, p_country text default null)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) + 1
  from private.weekly_entries e, private.weekly_entries me
  where me.id = p_entry_id
    and e.week_start = me.week_start
    and not e.hidden
    and e.id <> me.id
    and (private.country_filter(p_country) is null or e.country = private.country_filter(p_country))
    and (-e.points, e.lost, -e.goal_diff, -e.goals_for, e.created_at, e.id)
      < (-me.points, me.lost, -me.goal_diff, -me.goals_for, me.created_at, me.id)
$$;
revoke execute on function private.weekly_position(bigint, text) from public, anon, authenticated;
grant execute on function private.weekly_position(bigint, text) to service_role;

-- ------------------------------------------------- service-only writers

create or replace function public.svc_weekly_pin(p_week date, p_settings jsonb, p_settings_hash text, p_engine text, p_data text)
returns public.weekly_puzzles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v public.weekly_puzzles%rowtype;
  v_key text := to_char(p_week, 'IYYY-"W"IW');
begin
  insert into public.weekly_puzzles (week_start, week_key, seed, settings, settings_hash, engine_version, data_version)
  values (p_week, v_key, 'weekly-' || v_key, p_settings, p_settings_hash, p_engine, p_data)
  on conflict (week_start) do nothing;
  select * into v from public.weekly_puzzles w where w.week_start = p_week;
  return v;
end;
$$;
revoke execute on function public.svc_weekly_pin(date, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.svc_weekly_pin(date, jsonb, text, text, text) to service_role;

create or replace function public.svc_weekly_submit(p_user uuid, p_week date, p_entry jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v private.weekly_entries%rowtype;
  v_status text := 'ranked';
  v_name text;
  v_country text;
begin
  if not private.weekly_is_open(p_week) then
    return jsonb_build_object('status', 'closed');
  end if;
  if not exists (select 1 from public.weekly_puzzles w where w.week_start = p_week) then
    return jsonb_build_object('status', 'no_puzzle');
  end if;
  select * into v from private.weekly_entries e where e.week_start = p_week and e.user_id = p_user;
  if not found then
    v_name := private.ensure_display_name(p_user);
    select p.country into v_country from public.profiles p where p.user_id = p_user;
    insert into private.weekly_entries (
      week_start, user_id, display_name, country, team_name, points, won, drawn, lost, goals_for, goals_against,
      league_position, tier, payload, xi, history_key, draft_fingerprint, claim_matched, engine_version, data_version)
    values (
      p_week, p_user, v_name, v_country, p_entry ->> 'team_name', (p_entry ->> 'points')::smallint, (p_entry ->> 'won')::smallint,
      (p_entry ->> 'drawn')::smallint, (p_entry ->> 'lost')::smallint, (p_entry ->> 'goals_for')::smallint,
      (p_entry ->> 'goals_against')::smallint, (p_entry ->> 'league_position')::smallint, p_entry ->> 'tier',
      p_entry ->> 'payload', array(select jsonb_array_elements_text(p_entry -> 'xi')), p_entry ->> 'history_key',
      p_entry ->> 'draft_fingerprint', (p_entry ->> 'claim_matched')::boolean, p_entry ->> 'engine_version',
      p_entry ->> 'data_version')
    on conflict (week_start, user_id) do nothing
    returning * into v;
    if not found then
      select * into v from private.weekly_entries e where e.week_start = p_week and e.user_id = p_user;
      v_status := 'race';
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
    'position', private.weekly_position(v.id),
    'total', (select count(*) from private.weekly_entries e where e.week_start = p_week and not e.hidden),
    'country', v.country,
    'countryPosition', case when v.country is not null then private.weekly_position(v.id, v.country) end,
    'countryTotal', case when v.country is not null then (select count(*) from private.weekly_entries e where e.week_start = p_week and not e.hidden and e.country = v.country) end,
    'entry', jsonb_build_object('points', v.points, 'won', v.won, 'drawn', v.drawn, 'lost', v.lost,
      'goalsFor', v.goals_for, 'goalsAgainst', v.goals_against, 'leaguePosition', v.league_position, 'tier', v.tier,
      'claimMatched', v.claim_matched, 'dataVersion', v.data_version, 'createdAt', v.created_at));
end;
$$;
revoke execute on function public.svc_weekly_submit(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.svc_weekly_submit(uuid, date, jsonb) to service_role;

-- ------------------------------------------------------- public readers

create or replace function private.weekly_board_impl(p_week date, p_limit integer, p_offset integer, p_country text)
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
    select private.weekly_revealed(p_week) as open_book, private.country_filter(p_country) as c
  ), ranked as (
    select e.*, row_number() over (order by e.points desc, e.lost, e.goal_diff desc, e.goals_for desc, e.created_at, e.id) as pos
    from private.weekly_entries e, r
    where e.week_start = p_week and not e.hidden and (r.c is null or e.country = r.c)
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
revoke execute on function private.weekly_board_impl(date, integer, integer, text) from public;
grant execute on function private.weekly_board_impl(date, integer, integer, text) to anon, authenticated, service_role;

create or replace function public.weekly_board(p_week date, p_limit integer default 50, p_offset integer default 0, p_country text default null)
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
  select * from private.weekly_board_impl(p_week, p_limit, p_offset, p_country)
$$;
revoke execute on function public.weekly_board(date, integer, integer, text) from public;
grant execute on function public.weekly_board(date, integer, integer, text) to anon, authenticated, service_role;

create or replace function private.weekly_summary_impl(p_week date, p_country text)
returns table (played bigint, top_points smallint, my_entry_id bigint, my_position bigint, my_points smallint, posts_open boolean, revealed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from private.weekly_entries e where e.week_start = p_week and not e.hidden
            and (private.country_filter(p_country) is null or e.country = private.country_filter(p_country))),
         (select max(e.points) from private.weekly_entries e where e.week_start = p_week and not e.hidden
            and (private.country_filter(p_country) is null or e.country = private.country_filter(p_country))),
         me.id,
         case when me.id is not null and (private.country_filter(p_country) is null or me.country = private.country_filter(p_country))
              then private.weekly_position(me.id, p_country) end,
         me.points,
         private.weekly_is_open(p_week),
         private.weekly_revealed(p_week)
  from (select 1) one
  left join private.weekly_entries me on me.week_start = p_week and me.user_id = (select auth.uid())
$$;
revoke execute on function private.weekly_summary_impl(date, text) from public;
grant execute on function private.weekly_summary_impl(date, text) to anon, authenticated, service_role;

create or replace function public.weekly_summary(p_week date, p_country text default null)
returns table (played bigint, top_points smallint, my_entry_id bigint, my_position bigint, my_points smallint, posts_open boolean, revealed boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.weekly_summary_impl(p_week, p_country)
$$;
revoke execute on function public.weekly_summary(date, text) from public;
grant execute on function public.weekly_summary(date, text) to anon, authenticated, service_role;

create or replace function private.weekly_rank_impl(p_week date, p_points integer, p_lost integer, p_goal_diff integer, p_goals_for integer, p_country text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) + 1
  from private.weekly_entries e
  where e.week_start = p_week and not e.hidden
    and (private.country_filter(p_country) is null or e.country = private.country_filter(p_country))
    and (-e.points, e.lost, -e.goal_diff, -e.goals_for) <= (-p_points, p_lost, -p_goal_diff, -p_goals_for)
$$;
revoke execute on function private.weekly_rank_impl(date, integer, integer, integer, integer, text) from public;
grant execute on function private.weekly_rank_impl(date, integer, integer, integer, integer, text) to anon, authenticated, service_role;

create or replace function public.weekly_rank(p_week date, p_points integer, p_lost integer, p_goal_diff integer, p_goals_for integer, p_country text default null)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select private.weekly_rank_impl(p_week, p_points, p_lost, p_goal_diff, p_goals_for, p_country)
$$;
revoke execute on function public.weekly_rank(date, integer, integer, integer, integer, text) from public;
grant execute on function public.weekly_rank(date, integer, integer, integer, integer, text) to anon, authenticated, service_role;

create or replace function private.weekly_my_entries_impl(p_limit integer)
returns table (
  week_start date, week_key text, entry_id bigint, board_position bigint, total bigint, points smallint, won smallint, drawn smallint,
  lost smallint, goals_for smallint, goals_against smallint, tier text, team_name text, display_name text, country text,
  claim_matched boolean, data_version text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select e.week_start, to_char(e.week_start, 'IYYY-"W"IW'), e.id, private.weekly_position(e.id),
         (select count(*) from private.weekly_entries x where x.week_start = e.week_start and not x.hidden),
         e.points, e.won, e.drawn, e.lost, e.goals_for, e.goals_against, e.tier, e.team_name, e.display_name, e.country,
         e.claim_matched, e.data_version, e.created_at
  from private.weekly_entries e
  where e.user_id = (select auth.uid())
  order by e.week_start desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;
revoke execute on function private.weekly_my_entries_impl(integer) from public, anon;
grant execute on function private.weekly_my_entries_impl(integer) to authenticated;

create or replace function public.weekly_my_entries(p_limit integer default 30)
returns table (
  week_start date, week_key text, entry_id bigint, board_position bigint, total bigint, points smallint, won smallint, drawn smallint,
  lost smallint, goals_for smallint, goals_against smallint, tier text, team_name text, display_name text, country text,
  claim_matched boolean, data_version text, created_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.weekly_my_entries_impl(p_limit)
$$;
revoke execute on function public.weekly_my_entries(integer) from public, anon;
grant execute on function public.weekly_my_entries(integer) to authenticated;

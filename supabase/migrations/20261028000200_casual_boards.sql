-- migration: casual_boards
-- TouchLine online layer: world boards for the casual modes (docs/ONLINE.md section 5g). Three boards, each one fixed
-- puzzle for everyone in its period, pinned by the Edge Function from the live data at the first ranked post (as the
-- Daily is) and verified by replay; the replay's figures are filed, the posted claim only compared (claim_matched):
--
--   'arena'   the Daily Arena (seed 'arena-YYYY-MM-DD', key 'YYYY-MM-DD'): the Gauntlet or the Cup of 16, posts
--             open today and yesterday (UTC); only a run the assistant played can be replayed, so only those rank.
--             score = steps won; ordered by score, then goal difference, then fewer conceded, goals scored.
--   'themed'  the Weekly Challenge, mode 'weekly' (seed 'weekly-YYYY-Www', key 'YYYY-Www'): the week's themed wheel,
--             a different puzzle from the online weekly challenge on the same seed. score = league points.
--   'runin'   the Run-in of the week (seed 'runin-YYYY-Www'): the week's run-in job, four picks, then the assistant.
--             score = the final table's points.
--   A week's board takes posts from its Monday until 00:00 UTC on the Tuesday after (a day of grace); the league
--   boards order by score, then fewer defeats, goal difference, goals scored. First post stands: one entry per
--   account per board and period. Picks, XIs and payloads are revealed once posting has closed.
--
-- Same rules as every online migration: RLS on both tables with a deny-all policy for the client roles, explicit
-- grants after revoking this project's default privileges, SECURITY DEFINER only in private with a pinned
-- search_path, svc_* writers for service_role only; anon executes only the readers casual_board and casual_summary
-- (and their private helpers), authenticated also casual_my_entries (the allowlist in phase1_security.sql).
-- Re-runnable: every object is created if missing or replaced.

-- ------------------------------------------------------------------ periods

-- A board's period from its key: the Daily Arena's day, or the Monday of a week. Raises 22023 for anything else.
create or replace function private.casual_start_of(p_board text, p_key text)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v date;
begin
  if p_board = 'arena' then
    if p_key ~ '^\d{4}-\d{2}-\d{2}$' then
      begin
        v := to_date(p_key, 'YYYY-MM-DD');
      exception when others then
        v := null;
      end;
      if v is not null and to_char(v, 'YYYY-MM-DD') = p_key then
        return v;
      end if;
    end if;
  elsif p_board in ('themed', 'runin') then
    if p_key ~ '^\d{4}-W\d{2}$' then
      begin
        v := to_date(replace(p_key, '-W', '-'), 'IYYY-IW');
      exception when others then
        v := null;
      end;
      if v is not null and to_char(v, 'IYYY-"W"IW') = p_key then
        return v;
      end if;
    end if;
  else
    raise exception 'board is arena, themed or runin' using errcode = '22023';
  end if;
  raise exception 'not a % key: %', p_board, p_key using errcode = '22023';
end;
$$;
revoke execute on function private.casual_start_of(text, text) from public, anon, authenticated;
grant execute on function private.casual_start_of(text, text) to service_role;

-- When posting closes: two days after a Daily Arena's day (today and yesterday, as the Daily), the Tuesday after a week.
create or replace function private.casual_closes_at(p_board text, p_start date)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select ((p_start + case when p_board = 'arena' then 2 else 8 end)::timestamp at time zone 'UTC')
$$;
revoke execute on function private.casual_closes_at(text, date) from public, anon, authenticated;
grant execute on function private.casual_closes_at(text, date) to service_role;

create or replace function private.casual_is_open(p_board text, p_start date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select now() >= (p_start::timestamp at time zone 'UTC') and now() < private.casual_closes_at(p_board, p_start)
$$;
revoke execute on function private.casual_is_open(text, date) from public, anon, authenticated;
grant execute on function private.casual_is_open(text, date) to service_role;

-- ------------------------------------------------------------------ puzzles

create table if not exists private.casual_puzzles (
  board text not null check (board in ('arena', 'themed', 'runin')),
  period_start date not null,
  period_key text not null,
  seed text not null,
  settings jsonb not null check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 4096),
  settings_hash text not null check (char_length(settings_hash) between 1 and 32),
  engine_version text not null check (char_length(engine_version) between 1 and 16),
  data_version text not null check (char_length(data_version) between 1 and 40),
  created_at timestamptz not null default now(),
  primary key (board, period_start),
  constraint casual_puzzles_key check (
    (board = 'arena' and period_key = to_char(period_start, 'YYYY-MM-DD') and seed = 'arena-' || period_key)
    or (board = 'themed' and extract(isodow from period_start) = 1 and period_key = to_char(period_start, 'IYYY-"W"IW') and seed = 'weekly-' || period_key)
    or (board = 'runin' and extract(isodow from period_start) = 1 and period_key = to_char(period_start, 'IYYY-"W"IW') and seed = 'runin-' || period_key))
);
comment on table private.casual_puzzles is 'The pinned casual puzzles (Daily Arena, Weekly Challenge, Run-in of the week), computed by the Edge Function from the data the live site served at the first ranked post of the period. Never edited.';
alter table private.casual_puzzles enable row level security;
revoke all on private.casual_puzzles from public, anon, authenticated;
grant select, insert on private.casual_puzzles to service_role;
drop policy if exists casual_puzzles_service_only on private.casual_puzzles;
create policy casual_puzzles_service_only on private.casual_puzzles as restrictive for all to anon, authenticated using (false) with check (false);

-- ------------------------------------------------------------------ entries

create table if not exists private.casual_entries (
  id bigint generated always as identity primary key,
  board text not null check (board in ('arena', 'themed', 'runin')),
  period_start date not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  team_name text not null check (char_length(team_name) between 1 and 28 and team_name !~ '[[:cntrl:]]'),
  score smallint not null,
  won smallint not null check (won >= 0),
  drawn smallint not null check (drawn >= 0),
  lost smallint not null check (lost >= 0),
  goals_for smallint not null check (goals_for between 0 and 600),
  goals_against smallint not null check (goals_against between 0 and 600),
  goal_diff smallint generated always as (goals_for - goals_against) stored,
  -- The board's second and third keys, larger first: an arena run's goal difference then fewer conceded; a league's
  -- fewer defeats then goal difference
  rank_a smallint generated always as (case when board = 'arena' then goals_for - goals_against else -lost end) stored,
  rank_b smallint generated always as (case when board = 'arena' then -goals_against else goals_for - goals_against end) stored,
  league_position smallint check (league_position between 1 and 24),
  trophy boolean not null,
  detail text not null check (char_length(detail) between 1 and 40 and detail !~ '[[:cntrl:]]'),
  payload text not null check (char_length(payload) between 40 and 8000 and payload ~ '^[A-Za-z0-9_-]+$'),
  xi text[] not null check (cardinality(xi) between 11 and 18),
  history_key text not null check (char_length(history_key) between 1 and 16),
  draft_fingerprint text not null check (char_length(draft_fingerprint) between 1 and 32),
  claim_matched boolean not null,
  engine_version text not null check (char_length(engine_version) between 1 and 16),
  data_version text not null check (char_length(data_version) between 1 and 40),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (board, period_start, user_id),
  foreign key (board, period_start) references private.casual_puzzles (board, period_start) on delete cascade,
  constraint casual_entries_team_name_clean check (private.is_clean_name(team_name)),
  constraint casual_entries_figures check (
    (board = 'arena' and league_position is null and drawn = 0 and score = won and lost <= 1 and won + lost between 1 and 20)
    or (board = 'themed' and league_position is not null and score = 3 * won + drawn and won + drawn + lost between 30 and 46)
    or (board = 'runin' and league_position is not null and score between 0 and 140 and won + drawn + lost between 20 and 46))
);
comment on table private.casual_entries is 'Verified casual-board runs: the replay''s figures, one per account per board and period, written only by svc_casual_submit.';
create index if not exists casual_entries_board_idx
  on private.casual_entries (board, period_start, score desc, rank_a desc, rank_b desc, goals_for desc, created_at, id) where not hidden;
create index if not exists casual_entries_country_idx
  on private.casual_entries (board, period_start, country, score desc, rank_a desc, rank_b desc, goals_for desc, created_at, id) where not hidden;
create index if not exists casual_entries_user_idx on private.casual_entries (user_id, board, period_start desc);
alter table private.casual_entries enable row level security;
revoke all on private.casual_entries from public, anon, authenticated;
grant select, insert, update on private.casual_entries to service_role;
drop policy if exists casual_entries_service_only on private.casual_entries;
create policy casual_entries_service_only on private.casual_entries as restrictive for all to anon, authenticated using (false) with check (false);

-- An entry's place on its board (optionally one country's): one plus the visible entries ahead of it.
create or replace function private.casual_position(p_entry_id bigint, p_country text default null)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) + 1
  from private.casual_entries e, private.casual_entries me
  where me.id = p_entry_id
    and e.board = me.board and e.period_start = me.period_start
    and not e.hidden
    and e.id <> me.id
    and (private.country_filter(p_country) is null or e.country = private.country_filter(p_country))
    and (-e.score, -e.rank_a, -e.rank_b, -e.goals_for, e.created_at, e.id)
      < (-me.score, -me.rank_a, -me.rank_b, -me.goals_for, me.created_at, me.id)
$$;
revoke execute on function private.casual_position(bigint, text) from public, anon, authenticated;
grant execute on function private.casual_position(bigint, text) to service_role;

-- ------------------------------------------------- service-only writers

create or replace function private.casual_pin_json(p private.casual_puzzles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('board', p.board, 'key', p.period_key, 'seed', p.seed, 'settings', p.settings, 'settingsHash', p.settings_hash,
    'engineVersion', p.engine_version, 'dataVersion', p.data_version, 'createdAt', p.created_at)
$$;
revoke execute on function private.casual_pin_json(private.casual_puzzles) from public, anon, authenticated;
grant execute on function private.casual_pin_json(private.casual_puzzles) to service_role;

-- The period's pin, or null.
create or replace function public.svc_casual_get_pin(p_board text, p_key text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.casual_pin_json(p) from private.casual_puzzles p
  where p.board = p_board and p.period_start = private.casual_start_of(p_board, p_key)
$$;
revoke execute on function public.svc_casual_get_pin(text, text) from public, anon, authenticated;
grant execute on function public.svc_casual_get_pin(text, text) to service_role;

-- Pin a period's puzzle (the first pin stands) and return the pin.
create or replace function public.svc_casual_pin(p_board text, p_key text, p_settings jsonb, p_settings_hash text, p_engine text, p_data text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_start date := private.casual_start_of(p_board, p_key);
  v private.casual_puzzles%rowtype;
begin
  insert into private.casual_puzzles (board, period_start, period_key, seed, settings, settings_hash, engine_version, data_version)
  values (p_board, v_start, p_key, case p_board when 'arena' then 'arena-' when 'themed' then 'weekly-' else 'runin-' end || p_key,
    p_settings, p_settings_hash, p_engine, p_data)
  on conflict (board, period_start) do nothing;
  select * into v from private.casual_puzzles p where p.board = p_board and p.period_start = v_start;
  return private.casual_pin_json(v);
end;
$$;
revoke execute on function public.svc_casual_pin(text, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.svc_casual_pin(text, text, jsonb, text, text, text) to service_role;

-- File a verified run: 'ranked', or 'duplicate' / 'already_submitted' when the account posted this period already
-- (the first post stands), with its place; 'closed' or 'no_puzzle' otherwise.
create or replace function public.svc_casual_submit(p_user uuid, p_board text, p_key text, p_entry jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_start date := private.casual_start_of(p_board, p_key);
  v private.casual_entries%rowtype;
  v_status text := 'ranked';
  v_name text;
  v_country text;
begin
  if p_user is null then
    raise exception 'no user' using errcode = '22023';
  end if;
  if not private.casual_is_open(p_board, v_start) then
    return jsonb_build_object('status', 'closed');
  end if;
  if not exists (select 1 from private.casual_puzzles p where p.board = p_board and p.period_start = v_start) then
    return jsonb_build_object('status', 'no_puzzle');
  end if;
  select * into v from private.casual_entries e where e.board = p_board and e.period_start = v_start and e.user_id = p_user;
  if not found then
    v_name := private.ensure_display_name(p_user);
    select p.country into v_country from public.profiles p where p.user_id = p_user;
    insert into private.casual_entries (
      board, period_start, user_id, display_name, country, team_name, score, won, drawn, lost, goals_for, goals_against,
      league_position, trophy, detail, payload, xi, history_key, draft_fingerprint, claim_matched, engine_version, data_version)
    values (
      p_board, v_start, p_user, v_name, v_country, p_entry ->> 'team_name', (p_entry ->> 'score')::smallint,
      (p_entry ->> 'won')::smallint, (p_entry ->> 'drawn')::smallint, (p_entry ->> 'lost')::smallint,
      (p_entry ->> 'goals_for')::smallint, (p_entry ->> 'goals_against')::smallint, (p_entry ->> 'league_position')::smallint,
      (p_entry ->> 'trophy')::boolean, p_entry ->> 'detail', p_entry ->> 'payload',
      array(select jsonb_array_elements_text(p_entry -> 'xi')), p_entry ->> 'history_key', p_entry ->> 'draft_fingerprint',
      (p_entry ->> 'claim_matched')::boolean, p_entry ->> 'engine_version', p_entry ->> 'data_version')
    on conflict (board, period_start, user_id) do nothing
    returning * into v;
    if not found then
      select * into v from private.casual_entries e where e.board = p_board and e.period_start = v_start and e.user_id = p_user;
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
    'board', v.board,
    'key', p_key,
    'position', private.casual_position(v.id),
    'total', (select count(*) from private.casual_entries e where e.board = v.board and e.period_start = v.period_start and not e.hidden),
    'country', v.country,
    'countryPosition', case when v.country is not null then private.casual_position(v.id, v.country) end,
    'countryTotal', case when v.country is not null then (select count(*) from private.casual_entries e where e.board = v.board and e.period_start = v.period_start and not e.hidden and e.country = v.country) end,
    'entry', jsonb_build_object('points', v.score, 'score', v.score, 'won', v.won, 'drawn', v.drawn, 'lost', v.lost,
      'goalsFor', v.goals_for, 'goalsAgainst', v.goals_against, 'leaguePosition', v.league_position, 'trophy', v.trophy,
      'detail', v.detail, 'claimMatched', v.claim_matched, 'dataVersion', v.data_version, 'createdAt', v.created_at));
end;
$$;
revoke execute on function public.svc_casual_submit(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.svc_casual_submit(uuid, text, text, jsonb) to service_role;

-- ------------------------------------------------------- public readers

create or replace function private.casual_board_impl(p_board text, p_key text, p_limit integer, p_offset integer, p_country text)
returns table (
  board_position bigint, entry_id bigint, display_name text, country text, team_name text, score smallint, won smallint,
  drawn smallint, lost smallint, goals_for smallint, goals_against smallint, goal_diff smallint, league_position smallint,
  trophy boolean, detail text, data_version text, created_at timestamptz, is_me boolean, revealed boolean, payload text, xi text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  -- evaluated first, so a bad board or key is refused even on an empty board
  v_start date := private.casual_start_of(p_board, p_key);
  v_open_book boolean := now() >= private.casual_closes_at(p_board, private.casual_start_of(p_board, p_key));
  v_country text := private.country_filter(p_country);
begin
  return query
  with ranked as (
    select e.*, row_number() over (order by e.score desc, e.rank_a desc, e.rank_b desc, e.goals_for desc, e.created_at, e.id) as pos
    from private.casual_entries e
    where e.board = p_board and e.period_start = v_start and not e.hidden and (v_country is null or e.country = v_country)
  )
  select k.pos, k.id, k.display_name, k.country, k.team_name, k.score, k.won, k.drawn, k.lost, k.goals_for, k.goals_against,
         k.goal_diff, k.league_position, k.trophy, k.detail, k.data_version, k.created_at,
         k.user_id is not distinct from (select auth.uid()),
         v_open_book,
         case when v_open_book then k.payload end,
         case when v_open_book then k.xi end
  from ranked k
  order by k.pos
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000);
end;
$$;
revoke execute on function private.casual_board_impl(text, text, integer, integer, text) from public;
grant execute on function private.casual_board_impl(text, text, integer, integer, text) to anon, authenticated, service_role;

create or replace function public.casual_board(p_board text, p_key text, p_limit integer default 50, p_offset integer default 0, p_country text default null)
returns table (
  board_position bigint, entry_id bigint, display_name text, country text, team_name text, score smallint, won smallint,
  drawn smallint, lost smallint, goals_for smallint, goals_against smallint, goal_diff smallint, league_position smallint,
  trophy boolean, detail text, data_version text, created_at timestamptz, is_me boolean, revealed boolean, payload text, xi text[])
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.casual_board_impl(p_board, p_key, p_limit, p_offset, p_country)
$$;
revoke execute on function public.casual_board(text, text, integer, integer, text) from public;
grant execute on function public.casual_board(text, text, integer, integer, text) to anon, authenticated, service_role;

create or replace function private.casual_summary_impl(p_board text, p_key text, p_country text)
returns table (played bigint, top_score smallint, trophies bigint, my_entry_id bigint, my_position bigint, my_score smallint, posts_open boolean, revealed boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_start date := private.casual_start_of(p_board, p_key);
  v_country text := private.country_filter(p_country);
begin
  return query
  select (select count(*) from private.casual_entries e where e.board = p_board and e.period_start = v_start and not e.hidden and (v_country is null or e.country = v_country)),
         (select max(e.score) from private.casual_entries e where e.board = p_board and e.period_start = v_start and not e.hidden and (v_country is null or e.country = v_country)),
         (select count(*) from private.casual_entries e where e.board = p_board and e.period_start = v_start and not e.hidden and e.trophy and (v_country is null or e.country = v_country)),
         me.id,
         case when me.id is not null and not me.hidden and (v_country is null or me.country = v_country) then private.casual_position(me.id, p_country) end,
         me.score,
         private.casual_is_open(p_board, v_start),
         now() >= private.casual_closes_at(p_board, v_start)
  from (select 1) one
  left join private.casual_entries me on me.board = p_board and me.period_start = v_start and me.user_id = (select auth.uid());
end;
$$;
revoke execute on function private.casual_summary_impl(text, text, text) from public;
grant execute on function private.casual_summary_impl(text, text, text) to anon, authenticated, service_role;

create or replace function public.casual_summary(p_board text, p_key text, p_country text default null)
returns table (played bigint, top_score smallint, trophies bigint, my_entry_id bigint, my_position bigint, my_score smallint, posts_open boolean, revealed boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.casual_summary_impl(p_board, p_key, p_country)
$$;
revoke execute on function public.casual_summary(text, text, text) from public;
grant execute on function public.casual_summary(text, text, text) to anon, authenticated, service_role;

-- Signed in: the caller's own entries on one board (or every casual board when p_board is null), newest first.
create or replace function private.casual_my_entries_impl(p_board text, p_limit integer)
returns table (
  board text, period_key text, entry_id bigint, board_position bigint, total bigint, score smallint, won smallint, drawn smallint,
  lost smallint, goals_for smallint, goals_against smallint, league_position smallint, trophy boolean, detail text, team_name text,
  claim_matched boolean, data_version text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select e.board, case when e.board = 'arena' then to_char(e.period_start, 'YYYY-MM-DD') else to_char(e.period_start, 'IYYY-"W"IW') end,
         e.id, private.casual_position(e.id),
         (select count(*) from private.casual_entries x where x.board = e.board and x.period_start = e.period_start and not x.hidden),
         e.score, e.won, e.drawn, e.lost, e.goals_for, e.goals_against, e.league_position, e.trophy, e.detail, e.team_name,
         e.claim_matched, e.data_version, e.created_at
  from private.casual_entries e
  where e.user_id = (select auth.uid()) and (p_board is null or e.board = p_board)
  order by e.period_start desc, e.board
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;
revoke execute on function private.casual_my_entries_impl(text, integer) from public, anon;
grant execute on function private.casual_my_entries_impl(text, integer) to authenticated;

create or replace function public.casual_my_entries(p_board text default null, p_limit integer default 30)
returns table (
  board text, period_key text, entry_id bigint, board_position bigint, total bigint, score smallint, won smallint, drawn smallint,
  lost smallint, goals_for smallint, goals_against smallint, league_position smallint, trophy boolean, detail text, team_name text,
  claim_matched boolean, data_version text, created_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.casual_my_entries_impl(p_board, p_limit)
$$;
revoke execute on function public.casual_my_entries(text, integer) from public, anon;
grant execute on function public.casual_my_entries(text, integer) to authenticated;

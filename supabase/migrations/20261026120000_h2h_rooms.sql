-- migration: h2h_rooms
-- TouchLine online layer, Phase 2: online head-to-head rooms (docs/ONLINE.md section 5e).
--
-- Two managers draft from the same wheel on two devices, as the hot-seat head-to-head does on one, then both XIs
-- play the same league season. Nobody needs an account: the room's creator gets seat 0 and a link with an
-- 8-character code (#h=K7Q2MX9A), whoever opens it and joins gets seat 1. Anonymous sign-ins stay off, so guests
-- never hold a JWT: every write goes through the Edge Function (`room.create`, `room.join`, `room.pick`,
-- `room.leave`, `room.resume`), which issues each seat a random token, keeps only its SHA-256 here, replays the room
-- from its seed on every move with the game's own engine (src/game/logic/h2hRoom.ts) and files the result through
-- the svc_h2h_room_* functions below, executable by service_role only. Clients write nothing (invariant 14).
--
-- What anyone holding a code can read (public.h2h_peek, polled every few seconds by the two devices): the settings,
-- the two managers' names, shapes and clubs, the public log (where each spin landed and each pick), whose turn it
-- is, the version, the deadlines and, once finished, the season and the seed. Never a seat token or its hash, an
-- account id, or the seed of a room still drafting (so nobody can foresee the next spin).
--
-- Timing (mirrored by ROOM_WAIT_MINUTES, ROOM_IDLE_MINUTES and ROOM_KEEP_HOURS in src/game/logic/h2hRoom.ts and
-- pinned by retention.test.ts): a room nobody joins closes 30 minutes after it was made; a draft with no move for
-- 15 minutes times out; every room is deleted 24 hours after it ended. Readers and writers apply the deadlines at
-- once; the pg_cron job touchline-h2h-rooms (every 10 minutes) files them and purges.
--
-- Same rules as every online migration: RLS on the table with a deny-all policy for the client roles, explicit
-- grants after revoking this project's default privileges, SECURITY DEFINER only in private with a pinned
-- search_path, svc_* writers for service_role only, and anon and authenticated execute only the reader h2h_peek
-- and its private helper (both on the allowlist in supabase/tests/sql/phase1_security.sql).

-- ------------------------------------------------------------------- rooms

create table if not exists private.h2h_rooms (
  id bigint generated always as identity primary key,
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  seed text not null check (seed ~ '^room-[A-HJ-NP-Z2-9]{12}$'),
  settings jsonb not null check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 2048),
  manager0 jsonb not null check (jsonb_typeof(manager0) = 'object' and pg_column_size(manager0) <= 512),
  manager1 jsonb check (manager1 is null or (jsonb_typeof(manager1) = 'object' and pg_column_size(manager1) <= 512)),
  -- SHA-256 (lower-case hex) of each seat's token; the token itself is never stored
  seat0_hash text not null check (seat0_hash ~ '^[0-9a-f]{64}$'),
  seat1_hash text check (seat1_hash is null or seat1_hash ~ '^[0-9a-f]{64}$'),
  -- A signed-in manager's account, so they can take their seat back on another device (`room.resume`); null for guests
  seat0_user uuid references auth.users (id) on delete set null,
  seat1_user uuid references auth.users (id) on delete set null,
  events jsonb not null default '[]'::jsonb check (jsonb_typeof(events) = 'array' and jsonb_array_length(events) <= 160 and pg_column_size(events) <= 32768),
  turn smallint check (turn is null or turn in (0, 1)),
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 65536)),
  status text not null default 'waiting' check (status in ('waiting', 'drafting', 'finished', 'expired', 'timed_out', 'left')),
  version integer not null default 0 check (version >= 0),
  engine_version text not null check (engine_version ~ '^[0-9A-Za-z._-]{1,16}$'),
  data_version text not null check (data_version ~ '^[0-9A-Za-z._:-]{1,40}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  started_at timestamptz,
  last_move_at timestamptz,
  ended_at timestamptz,
  constraint h2h_rooms_seats check (seat1_hash is null or seat1_hash <> seat0_hash),
  constraint h2h_rooms_started check (status not in ('drafting', 'finished') or (manager1 is not null and seat1_hash is not null and started_at is not null and last_move_at is not null)),
  constraint h2h_rooms_turn check ((status = 'drafting') = (turn is not null)),
  constraint h2h_rooms_result check ((status = 'finished') = (result is not null)),
  constraint h2h_rooms_ended check ((status in ('waiting', 'drafting')) = (ended_at is null)),
  constraint h2h_rooms_window check (expires_at > created_at and expires_at <= created_at + interval '1 hour')
);
comment on table private.h2h_rooms is 'Online head-to-head rooms: written only by the svc_h2h_room_* functions (the Edge Function), read by public.h2h_room.';
create index if not exists h2h_rooms_open_idx on private.h2h_rooms (status) where status in ('waiting', 'drafting');
create index if not exists h2h_rooms_ended_idx on private.h2h_rooms (ended_at) where ended_at is not null;
create index if not exists h2h_rooms_seat0_user_idx on private.h2h_rooms (seat0_user) where seat0_user is not null;
create index if not exists h2h_rooms_seat1_user_idx on private.h2h_rooms (seat1_user) where seat1_user is not null;
alter table private.h2h_rooms enable row level security;
revoke all on private.h2h_rooms from public, anon, authenticated;
grant select, insert, update, delete on private.h2h_rooms to service_role;
drop policy if exists h2h_rooms_service_only on private.h2h_rooms;
create policy h2h_rooms_service_only on private.h2h_rooms as restrictive for all to anon, authenticated using (false) with check (false);

-- ------------------------------------------------------------------- helpers

-- How long a room waits for its second manager, how long a draft may sit idle, and how long an ended room is kept.
create or replace function private.h2h_wait()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '30 minutes'
$$;
create or replace function private.h2h_idle()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '15 minutes'
$$;
create or replace function private.h2h_keep()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '24 hours'
$$;
-- The most rooms open at once (waiting or drafting): a ceiling for the Free plan, not a per-player limit (the Edge
-- Function meters each caller).
create or replace function private.h2h_open_cap()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 300
$$;
revoke execute on function private.h2h_wait() from public, anon, authenticated;
revoke execute on function private.h2h_idle() from public, anon, authenticated;
revoke execute on function private.h2h_keep() from public, anon, authenticated;
revoke execute on function private.h2h_open_cap() from public, anon, authenticated;
grant execute on function private.h2h_wait(), private.h2h_idle(), private.h2h_keep(), private.h2h_open_cap() to service_role;

-- A room's status with its deadlines applied: a waiting room past expires_at has expired, a draft idle past the
-- idle limit has timed out, even before the sweep files it.
create or replace function private.h2h_room_status(r private.h2h_rooms)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when r.status = 'waiting' and now() >= r.expires_at then 'expired'
    when r.status = 'drafting' and now() >= r.last_move_at + private.h2h_idle() then 'timed_out'
    else r.status end
$$;
revoke execute on function private.h2h_room_status(private.h2h_rooms) from public, anon, authenticated;
grant execute on function private.h2h_room_status(private.h2h_rooms) to service_role;

-- When a room ended (or ends by its deadline): what the sweep files as ended_at.
create or replace function private.h2h_room_ended_at(r private.h2h_rooms)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case private.h2h_room_status(r)
    when 'expired' then coalesce(r.ended_at, r.expires_at)
    when 'timed_out' then coalesce(r.ended_at, r.last_move_at + private.h2h_idle())
    else r.ended_at end
$$;
revoke execute on function private.h2h_room_ended_at(private.h2h_rooms) from public, anon, authenticated;
grant execute on function private.h2h_room_ended_at(private.h2h_rooms) to service_role;

-- The public view of a room (the shape of RoomView in src/game/logic/h2hRoom.ts). No token hash, no account id, and
-- the seed only once the room is finished.
create or replace function private.h2h_room_json(r private.h2h_rooms)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'code', r.code,
    'status', private.h2h_room_status(r),
    'settings', r.settings,
    'managers', jsonb_build_array(r.manager0, r.manager1),
    'events', r.events,
    'version', r.version,
    'turn', case when private.h2h_room_status(r) = 'drafting' then r.turn end,
    'result', r.result,
    'seed', case when r.status = 'finished' then r.seed end,
    'engineVersion', r.engine_version,
    'dataVersion', r.data_version,
    'createdAt', r.created_at,
    'expiresAt', r.expires_at,
    'idleAt', case when r.status = 'drafting' then r.last_move_at + private.h2h_idle() end,
    'endedAt', private.h2h_room_ended_at(r))
$$;
revoke execute on function private.h2h_room_json(private.h2h_rooms) from public, anon, authenticated;
grant execute on function private.h2h_room_json(private.h2h_rooms) to service_role;

-- File the deadline of a room that passed it (inside a writer that holds the row lock).
create or replace function private.h2h_room_settle(p_id bigint)
returns private.h2h_rooms
language plpgsql
set search_path = ''
as $$
declare
  r private.h2h_rooms%rowtype;
  v_status text;
begin
  select * into r from private.h2h_rooms x where x.id = p_id;
  v_status := private.h2h_room_status(r);
  if v_status <> r.status then
    update private.h2h_rooms x set status = v_status, ended_at = private.h2h_room_ended_at(r), turn = null, version = x.version + 1
    where x.id = p_id returning * into r;
  end if;
  return r;
end;
$$;
revoke execute on function private.h2h_room_settle(bigint) from public, anon, authenticated;
grant execute on function private.h2h_room_settle(bigint) to service_role;

-- ---------------------------------------------------- service-only writers

-- A new room: a random code and seed, seat 0's manager and token hash. 'busy' when too many rooms are open.
create or replace function public.svc_h2h_room_create(p_settings jsonb, p_manager jsonb, p_seat_hash text, p_user uuid, p_engine text, p_data text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r private.h2h_rooms%rowtype;
  v_open integer;
begin
  select count(*) into v_open from private.h2h_rooms x
  where x.status in ('waiting', 'drafting') and private.h2h_room_status(x) in ('waiting', 'drafting');
  if v_open >= private.h2h_open_cap() then
    return jsonb_build_object('status', 'busy');
  end if;
  for i in 1 .. 8 loop
    insert into private.h2h_rooms (code, seed, settings, manager0, seat0_hash, seat0_user, engine_version, data_version, expires_at)
    values (private.random_code(8), 'room-' || private.random_code(12), p_settings, p_manager, p_seat_hash, p_user, p_engine, p_data, now() + private.h2h_wait())
    on conflict (code) do nothing
    returning * into r;
    if found then
      return jsonb_build_object('status', 'ok', 'room', private.h2h_room_json(r));
    end if;
  end loop;
  raise exception 'could not allocate a room code' using errcode = 'PT503';
end;
$$;
revoke execute on function public.svc_h2h_room_create(jsonb, jsonb, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.svc_h2h_room_create(jsonb, jsonb, text, uuid, text, text) to service_role;

-- Everything the server replays a room with: the seed, the managers, the log and the seat hashes. Null when missing.
create or replace function public.svc_h2h_room_get(p_code text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object('room', private.h2h_room_json(r), 'seed', r.seed, 'seat0Hash', r.seat0_hash, 'seat1Hash', r.seat1_hash,
    'seat0User', r.seat0_user, 'seat1User', r.seat1_user)
  from private.h2h_rooms r where r.code = private.normalise_code(p_code)
$$;
revoke execute on function public.svc_h2h_room_get(text) from public, anon, authenticated;
grant execute on function public.svc_h2h_room_get(text) to service_role;

-- The second manager takes seat 1 of a waiting room: the draft starts with the spins the server made (p_events,
-- up to the first pick, whose seat is p_turn). The version the server replayed must still be the room's.
create or replace function public.svc_h2h_room_join(p_code text, p_manager jsonb, p_seat_hash text, p_user uuid, p_events jsonb, p_turn smallint, p_expect_version integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r private.h2h_rooms%rowtype;
begin
  select * into r from private.h2h_rooms x where x.code = private.normalise_code(p_code) for update;
  if not found then
    return jsonb_build_object('status', 'missing');
  end if;
  r := private.h2h_room_settle(r.id);
  if r.status <> 'waiting' then
    return jsonb_build_object('status', case when r.status = 'drafting' or r.status = 'finished' then 'full' else 'closed' end, 'room', private.h2h_room_json(r));
  end if;
  if r.version <> p_expect_version then
    return jsonb_build_object('status', 'conflict', 'room', private.h2h_room_json(r));
  end if;
  if p_seat_hash is null or p_seat_hash = r.seat0_hash or p_turn is null or p_turn not in (0, 1)
     or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) < 1 then
    return jsonb_build_object('status', 'bad');
  end if;
  update private.h2h_rooms x
  set manager1 = p_manager, seat1_hash = p_seat_hash, seat1_user = p_user, events = p_events, turn = p_turn, status = 'drafting',
      started_at = now(), last_move_at = now(), version = x.version + 1
  where x.id = r.id returning * into r;
  return jsonb_build_object('status', 'ok', 'room', private.h2h_room_json(r));
end;
$$;
revoke execute on function public.svc_h2h_room_join(text, jsonb, text, uuid, jsonb, smallint, integer) from public, anon, authenticated;
grant execute on function public.svc_h2h_room_join(text, jsonb, text, uuid, jsonb, smallint, integer) to service_role;

-- A seat's pick, after the server's replay accepted it: p_events starts with that seat's pick and goes on with the
-- spins up to the next pick (p_turn), or the draft is complete and p_result holds the season. Refused unless the
-- token hash is that seat's, it is that seat's turn, the room is still drafting and nobody moved since p_expect_version.
create or replace function public.svc_h2h_room_move(p_code text, p_seat smallint, p_seat_hash text, p_expect_version integer, p_events jsonb, p_turn smallint, p_result jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r private.h2h_rooms%rowtype;
begin
  select * into r from private.h2h_rooms x where x.code = private.normalise_code(p_code) for update;
  if not found then
    return jsonb_build_object('status', 'missing');
  end if;
  if p_seat is null or p_seat not in (0, 1) or p_seat_hash is null
     or p_seat_hash is distinct from (case when p_seat = 0 then r.seat0_hash else r.seat1_hash end) then
    return jsonb_build_object('status', 'not_seated');
  end if;
  r := private.h2h_room_settle(r.id);
  if r.status <> 'drafting' then
    return jsonb_build_object('status', 'closed', 'room', private.h2h_room_json(r));
  end if;
  if r.turn is distinct from p_seat then
    return jsonb_build_object('status', 'not_your_turn', 'room', private.h2h_room_json(r));
  end if;
  if r.version <> p_expect_version then
    return jsonb_build_object('status', 'conflict', 'room', private.h2h_room_json(r));
  end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) < 1
     or p_events -> 0 ->> 't' is distinct from 'p' or (p_events -> 0 ->> 'seat') is distinct from p_seat::text
     or (p_result is null and (p_turn is null or p_turn not in (0, 1))) then
    return jsonb_build_object('status', 'bad');
  end if;
  update private.h2h_rooms x
  set events = x.events || p_events,
      turn = case when p_result is null then p_turn end,
      result = p_result,
      status = case when p_result is null then 'drafting' else 'finished' end,
      ended_at = case when p_result is null then null else now() end,
      last_move_at = now(),
      version = x.version + 1
  where x.id = r.id returning * into r;
  return jsonb_build_object('status', 'ok', 'room', private.h2h_room_json(r));
end;
$$;
revoke execute on function public.svc_h2h_room_move(text, smallint, text, integer, jsonb, smallint, jsonb) from public, anon, authenticated;
grant execute on function public.svc_h2h_room_move(text, smallint, text, integer, jsonb, smallint, jsonb) to service_role;

-- A manager leaves a room that has not ended (either seat's token). The other device reads 'left' on its next poll.
create or replace function public.svc_h2h_room_leave(p_code text, p_seat_hash text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r private.h2h_rooms%rowtype;
begin
  select * into r from private.h2h_rooms x where x.code = private.normalise_code(p_code) for update;
  if not found then
    return jsonb_build_object('status', 'missing');
  end if;
  if p_seat_hash is null or (p_seat_hash is distinct from r.seat0_hash and p_seat_hash is distinct from r.seat1_hash) then
    return jsonb_build_object('status', 'not_seated');
  end if;
  r := private.h2h_room_settle(r.id);
  if r.status not in ('waiting', 'drafting') then
    return jsonb_build_object('status', 'closed', 'room', private.h2h_room_json(r));
  end if;
  update private.h2h_rooms x set status = 'left', turn = null, ended_at = now(), version = x.version + 1
  where x.id = r.id returning * into r;
  return jsonb_build_object('status', 'ok', 'room', private.h2h_room_json(r));
end;
$$;
revoke execute on function public.svc_h2h_room_leave(text, text) from public, anon, authenticated;
grant execute on function public.svc_h2h_room_leave(text, text) to service_role;

-- A signed-in manager takes their seat back on another device: the seat's token is replaced by a new one (the old
-- device's token stops working). Only for a room that has not ended, only for the account that took the seat.
create or replace function public.svc_h2h_room_reseat(p_code text, p_user uuid, p_seat_hash text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r private.h2h_rooms%rowtype;
  v_seat smallint;
begin
  if p_user is null or p_seat_hash is null or p_seat_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'bad');
  end if;
  select * into r from private.h2h_rooms x where x.code = private.normalise_code(p_code) for update;
  if not found then
    return jsonb_build_object('status', 'missing');
  end if;
  v_seat := case when r.seat0_user = p_user then 0 when r.seat1_user = p_user then 1 end;
  if v_seat is null then
    return jsonb_build_object('status', 'not_seated');
  end if;
  r := private.h2h_room_settle(r.id);
  if r.status not in ('waiting', 'drafting') then
    return jsonb_build_object('status', 'closed', 'room', private.h2h_room_json(r));
  end if;
  if v_seat = 0 then
    update private.h2h_rooms x set seat0_hash = p_seat_hash where x.id = r.id returning * into r;
  else
    update private.h2h_rooms x set seat1_hash = p_seat_hash where x.id = r.id returning * into r;
  end if;
  return jsonb_build_object('status', 'ok', 'seat', v_seat, 'room', private.h2h_room_json(r));
end;
$$;
revoke execute on function public.svc_h2h_room_reseat(text, uuid, text) from public, anon, authenticated;
grant execute on function public.svc_h2h_room_reseat(text, uuid, text) to service_role;

-- ------------------------------------------------------------ public reader

-- A room by its code, for anyone holding it (signed in or not): the public view, or null for no such room. With
-- p_since equal to the room's version (and no deadline passed since), only {unchanged, version, status}, so the
-- two devices' polls cost a few bytes while nobody moves.
create or replace function private.h2h_peek_impl(p_code text, p_since integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r private.h2h_rooms%rowtype;
  v_status text;
begin
  select * into r from private.h2h_rooms x where x.code = private.normalise_code(p_code);
  if not found then
    return null;
  end if;
  v_status := private.h2h_room_status(r);
  if p_since is not null and p_since = r.version and v_status = r.status then
    return jsonb_build_object('unchanged', true, 'version', r.version, 'status', v_status);
  end if;
  return private.h2h_room_json(r);
end;
$$;
revoke execute on function private.h2h_peek_impl(text, integer) from public;
grant execute on function private.h2h_peek_impl(text, integer) to anon, authenticated, service_role;

create or replace function public.h2h_peek(p_code text, p_since integer default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.h2h_peek_impl(p_code, p_since)
$$;
revoke execute on function public.h2h_peek(text, integer) from public;
grant execute on function public.h2h_peek(text, integer) to anon, authenticated, service_role;

-- ------------------------------------------------------------------- sweep

-- File every passed deadline and delete every room that ended more than 24 hours ago. Owner only (the cron job).
create or replace function private.h2h_rooms_sweep()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_closed integer;
  v_purged integer;
begin
  with due as (
    select x.id, private.h2h_room_status(x) as s, private.h2h_room_ended_at(x) as e
    from private.h2h_rooms x
    where x.status in ('waiting', 'drafting') and private.h2h_room_status(x) not in ('waiting', 'drafting')
  )
  update private.h2h_rooms x set status = due.s, ended_at = due.e, turn = null, version = x.version + 1
  from due where x.id = due.id;
  get diagnostics v_closed = row_count;
  delete from private.h2h_rooms x where x.ended_at is not null and x.ended_at < now() - private.h2h_keep();
  get diagnostics v_purged = row_count;
  return jsonb_build_object('closed', v_closed, 'purged', v_purged);
end;
$$;
revoke execute on function private.h2h_rooms_sweep() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('touchline-h2h-rooms', '*/10 * * * *', $job$ select private.h2h_rooms_sweep(); $job$);
  else
    raise notice 'pg_cron is not available: touchline-h2h-rooms not scheduled (rooms still expire on read and write)';
  end if;
end
$$;

-- Phase 2 assertions: online head-to-head rooms (migration h2h_rooms). Who can reach what, seat tokens, turn order,
-- the compare-and-set on the version, the 30-minute join window, the 15-minute idle timeout, the 24-hour purge and
-- the public view (no token hash, no account id, no seed before the end). Runs in one transaction and rolls back.
\set ON_ERROR_STOP on
\pset pager off
begin;

insert into auth.users (id, email, is_anonymous) values
  ('55555555-5555-4555-8555-555555555555', 'dana@example.com', false), ('66666666-6666-4666-8666-666666666666', 'eli@example.com', false);
create temp table k (name text primary key, v text);
grant all on k to public;
-- Seat token hashes (the server sends SHA-256 hex; 64 hex characters stand in for one), settings and managers. psql
-- variables do not reach inside dollar quotes, so these are functions in the stand-in's test schema.
create function test.h(c text) returns text language sql immutable as $$ select repeat(c, 64) $$;
create function test.s() returns jsonb language sql immutable as $$ select '{"leagueId":"england","wheelLeagues":["england"],"leagueSeason":2025,"difficulty":"calibrated","hardMode":false}'::jsonb $$;
create function test.m(n int) returns jsonb language sql immutable as $$
  select case when n = 0 then '{"name":"Ana","shortName":"A","formationId":"4-3-3","hostClubId":"arsenal"}'::jsonb
              else '{"name":"Ben","shortName":"B","formationId":"4-4-2","hostClubId":"chelsea"}'::jsonb end $$;
grant execute on function test.h(text), test.s(), test.m(int) to anon, authenticated, service_role;

\echo '--- rooms: the client roles reach the reader only, never the table or a writer'
do $t$ begin
  assert not has_table_privilege('anon', 'private.h2h_rooms', 'select'), 'anon reads the rooms table';
  assert not has_table_privilege('authenticated', 'private.h2h_rooms', 'select,insert,update,delete'), 'authenticated touches the rooms table';
  assert has_function_privilege('anon', 'public.h2h_peek(text, integer)', 'execute'), 'anon cannot read a room';
  assert not has_function_privilege('anon', 'public.svc_h2h_room_create(jsonb, jsonb, text, uuid, text, text)', 'execute'), 'anon can create a room';
  assert not has_function_privilege('authenticated', 'public.svc_h2h_room_move(text, smallint, text, integer, jsonb, smallint, jsonb)', 'execute'), 'authenticated can move';
  assert not has_function_privilege('authenticated', 'public.svc_h2h_room_get(text)', 'execute'), 'authenticated can read seeds';
  assert not has_function_privilege('service_role', 'private.h2h_rooms_sweep()', 'execute'), 'the sweep is the owner''s (cron) only';
  assert not has_function_privilege('anon', 'private.h2h_rooms_sweep()', 'execute'), 'anon can sweep';
  assert (select prosecdef from pg_proc where oid = 'private.h2h_peek_impl(text, integer)'::regprocedure), 'the reader runs as its owner';
end $t$;

select test.act('anon', null) \gset
do $t$ begin
  assert test.try($$select public.svc_h2h_room_create('{}', '{}', repeat('a', 64), null, '4', 'x')$$) like '42501%', 'anon created a room';
  assert test.try($$select * from private.h2h_rooms$$) like '42501%', 'anon read the rooms table';
end $t$;
reset role;

\echo '--- rooms: creating a room issues a code and keeps the seed and the hash private'
select test.act('service_role', null) \gset
do $t$ declare r jsonb; begin
  r := public.svc_h2h_room_create(test.s(), test.m(0), test.h('a'), '55555555-5555-4555-8555-555555555555'::uuid, '4', '2026-10-20');
  assert r ->> 'status' = 'ok', r::text;
  assert r #>> '{room,code}' ~ '^[A-HJ-NP-Z2-9]{8}$', r::text;
  assert r #>> '{room,status}' = 'waiting' and (r #> '{room,seed}') = 'null'::jsonb and (r #>> '{room,version}')::int = 0, r::text;
  assert r::text not like '%aaaaaaaa%' and r::text not like '%55555555-5555%', 'the create answer leaks a hash or an account';
  insert into k values ('room', r #>> '{room,code}');
end $t$;
reset role;
do $t$ begin
  assert (select seed ~ '^room-[A-HJ-NP-Z2-9]{12}$' from private.h2h_rooms where code = (select v from k where name = 'room')), 'seed shape';
  assert (select expires_at = created_at + interval '30 minutes' from private.h2h_rooms where code = (select v from k where name = 'room')), 'a room waits 30 minutes';
end $t$;

\echo '--- rooms: anyone with the code reads the public view, with any spacing or case'
select test.act('anon', null) \gset
do $t$ declare r jsonb; c text := (select v from k where name = 'room'); begin
  r := public.h2h_peek(lower(substr(c, 1, 4)) || '-' || substr(c, 5));
  assert r ->> 'code' = c and r ->> 'status' = 'waiting', r::text;
  assert r::text not like '%aaaaaaaa%' and r::text not like '%5555%' and r::text not like '%room-%', 'the view leaks a hash, an account or the seed';
  assert public.h2h_peek('ZZZZZZZZ') is null, 'a missing room reads null';
  -- polling with the version just read costs a few bytes
  r := public.h2h_peek(c, 0);
  assert r = jsonb_build_object('unchanged', true, 'version', 0, 'status', 'waiting'), r::text;
end $t$;
reset role;

\echo '--- rooms: joining needs a waiting room, the version the server replayed and a token of its own'
select test.act('service_role', null) \gset
do $t$ declare r jsonb; c text := (select v from k where name = 'room'); ev jsonb := '[{"t":"s","cs":"spurs@2025"}]'; begin
  r := public.svc_h2h_room_join(c, test.m(1), test.h('b'), '66666666-6666-4666-8666-666666666666'::uuid, ev, 1::smallint, 5);
  assert r ->> 'status' = 'conflict', r::text;
  r := public.svc_h2h_room_join(c, test.m(1), test.h('a'), '66666666-6666-4666-8666-666666666666'::uuid, ev, 1::smallint, 0);
  assert r ->> 'status' = 'bad', 'seat 1 reused seat 0''s token: ' || r::text;
  r := public.svc_h2h_room_join(c, test.m(1), test.h('b'), '66666666-6666-4666-8666-666666666666'::uuid, '[]', 1::smallint, 0);
  assert r ->> 'status' = 'bad', 'a join with no spin: ' || r::text;
  r := public.svc_h2h_room_join('ZZZZZZZZ', test.m(1), test.h('b'), '66666666-6666-4666-8666-666666666666'::uuid, ev, 1::smallint, 0);
  assert r ->> 'status' = 'missing', r::text;
  r := public.svc_h2h_room_join(c, test.m(1), test.h('b'), '66666666-6666-4666-8666-666666666666'::uuid, ev, 1::smallint, 0);
  assert r ->> 'status' = 'ok' and r #>> '{room,status}' = 'drafting' and (r #>> '{room,turn}')::int = 1 and (r #>> '{room,version}')::int = 1, r::text;
  assert r #> '{room,managers,1,name}' = '"Ben"' and r #> '{room,events}' = ev, r::text;
  assert r #> '{room,seed}' = 'null'::jsonb and r #>> '{room,idleAt}' is not null, 'the seed stays hidden while drafting: ' || r::text;
  r := public.svc_h2h_room_join(c, test.m(1), test.h('c'), null, ev, 0::smallint, 1);
  assert r ->> 'status' = 'full', 'a third manager joined: ' || r::text;
end $t$;

\echo '--- rooms: a move needs the seat''s token, its turn, the current version and a pick by that seat first'
do $t$ declare r jsonb; c text := (select v from k where name = 'room');
  pick1 jsonb := '[{"t":"p","seat":1,"p":"x@2025@spurs","k":"GK"}]';
  pick0 jsonb := '[{"t":"p","seat":0,"p":"y@2025@spurs","k":"GK"},{"t":"s","cs":"leeds@2025"}]';
begin
  r := public.svc_h2h_room_move(c, 1::smallint, test.h('a'), 1, pick1, 0::smallint, null);
  assert r ->> 'status' = 'not_seated', 'seat 0''s token moved for seat 1: ' || r::text;
  r := public.svc_h2h_room_move(c, 1::smallint, test.h('c'), 1, pick1, 0::smallint, null);
  assert r ->> 'status' = 'not_seated', 'a made-up token moved: ' || r::text;
  r := public.svc_h2h_room_move(c, 0::smallint, test.h('a'), 1, pick0, 1::smallint, null);
  assert r ->> 'status' = 'not_your_turn', 'seat 0 moved on seat 1''s turn: ' || r::text;
  r := public.svc_h2h_room_move(c, 1::smallint, test.h('b'), 0, pick1, 0::smallint, null);
  assert r ->> 'status' = 'conflict', 'a stale version moved: ' || r::text;
  r := public.svc_h2h_room_move(c, 1::smallint, test.h('b'), 1, '[{"t":"p","seat":0,"p":"x","k":"GK"}]', 0::smallint, null);
  assert r ->> 'status' = 'bad', 'a move led by the other seat''s pick: ' || r::text;
  r := public.svc_h2h_room_move(c, 1::smallint, test.h('b'), 1, pick1, null, null);
  assert r ->> 'status' = 'bad', 'a move with no next turn and no result: ' || r::text;
  r := public.svc_h2h_room_move(c, 1::smallint, test.h('b'), 1, pick1, 0::smallint, null);
  assert r ->> 'status' = 'ok' and (r #>> '{room,turn}')::int = 0 and (r #>> '{room,version}')::int = 2 and jsonb_array_length(r #> '{room,events}') = 2, r::text;
  r := public.svc_h2h_room_move(c, 1::smallint, test.h('b'), 2, pick1, 0::smallint, null);
  assert r ->> 'status' = 'not_your_turn', 'seat 1 moved twice: ' || r::text;
  r := public.svc_h2h_room_move(c, 0::smallint, test.h('a'), 2, pick0, 1::smallint, null);
  assert r ->> 'status' = 'ok' and (r #>> '{room,turn}')::int = 1 and jsonb_array_length(r #> '{room,events}') = 4, r::text;
end $t$;
reset role;

\echo '--- rooms: a draft idle for 15 minutes times out, on read and on write, then the sweep files it'
update private.h2h_rooms set last_move_at = now() - interval '16 minutes', started_at = now() - interval '20 minutes' where code = (select v from k where name = 'room');
select test.act('anon', null) \gset
do $t$ declare r jsonb; c text := (select v from k where name = 'room'); begin
  r := public.h2h_peek(c, 3);
  assert r ->> 'status' = 'timed_out' and r -> 'turn' = 'null'::jsonb and (r ->> 'endedAt') is not null, 'an idle draft still reads open: ' || r::text;
end $t$;
reset role;
select test.act('service_role', null) \gset
do $t$ declare r jsonb; c text := (select v from k where name = 'room'); begin
  r := public.svc_h2h_room_move(c, 1::smallint, test.h('b'), 3, '[{"t":"p","seat":1,"p":"z","k":"LB"}]', 0::smallint, null);
  assert r ->> 'status' = 'closed' and r #>> '{room,status}' = 'timed_out', 'a move after the idle limit: ' || r::text;
end $t$;
reset role;
do $t$ begin
  assert (select status = 'timed_out' and ended_at = last_move_at + interval '15 minutes' and turn is null from private.h2h_rooms where code = (select v from k where name = 'room')), 'the timeout was not filed at its deadline';
end $t$;

\echo '--- rooms: nobody joins within 30 minutes and the room closes'
select test.act('service_role', null) \gset
do $t$ declare r jsonb; begin
  r := public.svc_h2h_room_create(test.s(), test.m(0), test.h('a'), null, '4', '2026-10-20');
  insert into k values ('late', r #>> '{room,code}');
end $t$;
reset role;
update private.h2h_rooms set created_at = now() - interval '31 minutes', expires_at = now() - interval '1 minute' where code = (select v from k where name = 'late');
select test.act('anon', null) \gset
do $t$ begin
  assert public.h2h_peek((select v from k where name = 'late')) ->> 'status' = 'expired', 'a room past its join window reads open';
end $t$;
reset role;
select test.act('service_role', null) \gset
do $t$ declare r jsonb; begin
  r := public.svc_h2h_room_join((select v from k where name = 'late'), test.m(1), test.h('b'), null, '[{"t":"s","cs":"a@2025"}]', 0::smallint, 0);
  assert r ->> 'status' = 'closed' and r #>> '{room,status}' = 'expired', 'joined an expired room: ' || r::text;
end $t$;

\echo '--- rooms: the last pick files the season, ends the room and reveals the seed'
do $t$ declare r jsonb; c text; res jsonb := '{"winner":0,"positions":[1,3]}'; begin
  r := public.svc_h2h_room_create(test.s(), test.m(0), test.h('a'), '55555555-5555-4555-8555-555555555555'::uuid, '4', '2026-10-20');
  c := r #>> '{room,code}';
  insert into k values ('done', c);
  r := public.svc_h2h_room_join(c, test.m(1), test.h('b'), null, '[{"t":"s","cs":"a@2025"}]', 0::smallint, 0);
  r := public.svc_h2h_room_move(c, 0::smallint, test.h('a'), 1, '[{"t":"p","seat":0,"p":"x","k":"ST"}]', null, res);
  assert r ->> 'status' = 'ok' and r #>> '{room,status}' = 'finished' and r #> '{room,result}' = res and r #> '{room,turn}' = 'null'::jsonb, r::text;
  assert r #>> '{room,seed}' ~ '^room-', 'the seed is revealed with the result: ' || r::text;
  r := public.svc_h2h_room_move(c, 1::smallint, test.h('b'), 2, '[{"t":"p","seat":1,"p":"y","k":"ST"}]', 0::smallint, null);
  assert r ->> 'status' = 'closed', 'a move after the end: ' || r::text;
  r := public.svc_h2h_room_leave(c, test.h('b'));
  assert r ->> 'status' = 'closed', 'left a finished room: ' || r::text;
end $t$;

\echo '--- rooms: either manager can leave a room that has not ended; strangers cannot'
do $t$ declare r jsonb; c text; begin
  r := public.svc_h2h_room_create(test.s(), test.m(0), test.h('a'), null, '4', '2026-10-20');
  c := r #>> '{room,code}';
  r := public.svc_h2h_room_leave(c, test.h('c'));
  assert r ->> 'status' = 'not_seated', r::text;
  r := public.svc_h2h_room_leave(c, test.h('a'));
  assert r ->> 'status' = 'ok' and r #>> '{room,status}' = 'left', r::text;
  r := public.svc_h2h_room_join(c, test.m(1), test.h('b'), null, '[{"t":"s","cs":"a@2025"}]', 0::smallint, 1);
  assert r ->> 'status' = 'closed', 'joined a room its creator left: ' || r::text;
end $t$;

\echo '--- rooms: a signed-in manager takes their seat back on another device; the old token stops working'
do $t$ declare r jsonb; c text; begin
  r := public.svc_h2h_room_create(test.s(), test.m(0), test.h('a'), '55555555-5555-4555-8555-555555555555'::uuid, '4', '2026-10-20');
  c := r #>> '{room,code}';
  r := public.svc_h2h_room_join(c, test.m(1), test.h('b'), null, '[{"t":"s","cs":"a@2025"}]', 0::smallint, 0);
  r := public.svc_h2h_room_reseat(c, '66666666-6666-4666-8666-666666666666'::uuid, test.h('d'));
  assert r ->> 'status' = 'not_seated', 'another account took seat 0: ' || r::text;
  r := public.svc_h2h_room_reseat(c, '55555555-5555-4555-8555-555555555555'::uuid, 'nothex');
  assert r ->> 'status' = 'bad', r::text;
  r := public.svc_h2h_room_reseat(c, '55555555-5555-4555-8555-555555555555'::uuid, test.h('d'));
  assert r ->> 'status' = 'ok' and (r ->> 'seat')::int = 0, r::text;
  r := public.svc_h2h_room_move(c, 0::smallint, test.h('a'), 1, '[{"t":"p","seat":0,"p":"x","k":"ST"}]', 1::smallint, null);
  assert r ->> 'status' = 'not_seated', 'the replaced token still moves: ' || r::text;
  r := public.svc_h2h_room_move(c, 0::smallint, test.h('d'), 1, '[{"t":"p","seat":0,"p":"x","k":"ST"}]', 1::smallint, null);
  assert r ->> 'status' = 'ok', 'the new token cannot move: ' || r::text;
end $t$;
reset role;

\echo '--- rooms: deleting an account keeps the room and forgets the account'
delete from auth.users where id = '55555555-5555-4555-8555-555555555555'::uuid;
do $t$ begin
  assert (select count(*) from private.h2h_rooms where seat0_user = '55555555-5555-4555-8555-555555555555'::uuid) = 0, 'a deleted account is still on a seat';
  assert exists (select 1 from private.h2h_rooms where code = (select v from k where name = 'done')), 'the room went with the account';
end $t$;

\echo '--- rooms: at most 300 rooms are open at once'
insert into private.h2h_rooms (code, seed, settings, manager0, seat0_hash, engine_version, data_version)
select 'Q' || lpad(translate(to_hex(g), '0123456789abcdef', 'ABCDEFGHJKLMNPQR'), 7, 'A'), 'room-AAAAAAAAAAAA', test.s(), test.m(0), test.h('a'), '4', '2026-10-20'
from generate_series(1, 300) g;
select test.act('service_role', null) \gset
do $t$ begin
  assert public.svc_h2h_room_create(test.s(), test.m(0), test.h('a'), null, '4', '2026-10-20') ->> 'status' = 'busy', 'a 301st open room was made';
end $t$;
reset role;
delete from private.h2h_rooms where code like 'Q%' and seed = 'room-AAAAAAAAAAAA';

\echo '--- rooms: the sweep files passed deadlines and deletes rooms 24 hours after they ended'
update private.h2h_rooms set ended_at = now() - interval '25 hours' where code = (select v from k where name = 'done');
update private.h2h_rooms set created_at = now() - interval '26 hours', expires_at = now() - interval '25 hours 30 minutes', status = 'waiting', ended_at = null where code = (select v from k where name = 'late');
insert into private.h2h_rooms (code, seed, settings, manager0, seat0_hash, engine_version, data_version, status, ended_at, created_at, expires_at)
values ('RECENT23', 'room-AAAAAAAAAAAA', test.s(), test.m(0), test.h('a'), '4', '2026-10-20', 'left', now() - interval '23 hours', now() - interval '23 hours 10 minutes', now() - interval '23 hours');
do $t$ declare r jsonb; begin
  r := private.h2h_rooms_sweep();
  assert (r ->> 'purged')::int >= 2, r::text;
  assert not exists (select 1 from private.h2h_rooms where code in ((select v from k where name = 'done'), (select v from k where name = 'late'))), 'a room ended over 24 hours ago is still here';
  assert exists (select 1 from private.h2h_rooms where code = 'RECENT23'), 'a room ended 23 hours ago was purged';
  assert not exists (select 1 from private.h2h_rooms where status in ('waiting', 'drafting') and private.h2h_room_status(h2h_rooms) not in ('waiting', 'drafting')), 'a passed deadline was not filed';
end $t$;

rollback;
\echo 'ROOMS ASSERTIONS PASSED'

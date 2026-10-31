-- Phase 1 assertions: catalog hygiene, profiles, cloud saves, the Daily board, the world leaderboard (all-time
-- Daily totals, the weekly challenge, country filters), challenge codes, deletion.
\set ON_ERROR_STOP on
\pset pager off
\set A '''11111111-1111-4111-8111-111111111111'''
\set B '''22222222-2222-4222-8222-222222222222'''
\set C '''33333333-3333-4333-8333-333333333333'''
\set G '''44444444-4444-4444-8444-444444444444'''

\echo '--- catalog: RLS on every table in public and private'
do $t$ declare n int; begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname in ('public', 'private') and c.relkind = 'r' and not c.relrowsecurity;
  assert n = 0, format('%s tables without RLS', n);
end $t$;

\echo '--- catalog: anon may only read the two puzzle tables; nobody but the owner and service_role writes a table directly'
do $t$ declare n int; begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname in ('public', 'private') and c.relkind = 'r'
    and (has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete') or has_table_privilege('anon', c.oid, 'truncate')
         or (has_table_privilege('anon', c.oid, 'select') and c.relname not in ('daily_puzzles', 'weekly_puzzles')));
  assert n = 0, format('%s tables reachable by anon beyond the puzzle reads', n);
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname in ('public', 'private') and c.relkind = 'r'
    and (has_table_privilege('authenticated', c.oid, 'truncate') or has_table_privilege('authenticated', c.oid, 'references') or has_table_privilege('authenticated', c.oid, 'trigger')
         or has_table_privilege('authenticated', c.oid, 'update') or has_table_privilege('authenticated', c.oid, 'insert'));
  assert n = 0, format('%s tables with table-wide write grants for authenticated (profiles uses column grants only)', n);
end $t$;

do $t$ declare n int; begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname in ('public', 'private') and c.relkind = 'r'
    and not exists (select 1 from pg_policies p where p.schemaname = s.nspname and p.tablename = c.relname);
  assert n = 0, format('%s tables with RLS but no policy (Security Advisor lint 0008)', n);
end $t$;

\echo '--- catalog: no SECURITY DEFINER in public, search_path pinned everywhere'
do $t$ declare n int; m int; begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prosecdef;
  assert n = 0, format('%s definer functions in public', n);
  select count(*) into m from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname in ('public', 'private') and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) x where x like 'search_path=%');
  assert m = 0, format('%s functions without a pinned search_path', m);
end $t$;

\echo '--- catalog: what anon can execute in public, and svc_* is service_role only'
select string_agg(p.proname, ', ' order by p.proname) as anon_can_execute
from pg_proc p join pg_namespace s on s.oid = p.pronamespace
where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
do $t$ declare n int; begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.proname like 'svc\_%'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or not has_function_privilege('service_role', p.oid, 'execute'));
  assert n = 0, format('%s svc_ functions reachable by a client role', n);
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in ('daily_board', 'daily_summary', 'daily_rank', 'daily_alltime_board', 'weekly_board', 'weekly_summary', 'weekly_rank', 'get_challenge', 'h2h_peek', 'chase_board', 'chase_summary', 'casual_board', 'casual_summary');
  assert n = 0, 'anon can execute a public function outside the read list';
end $t$;

do $t$ declare n int; begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname in ('daily_board', 'daily_summary', 'daily_rank', 'daily_alltime_board', 'weekly_board', 'weekly_summary', 'weekly_rank', 'get_challenge');
  assert n = 8, format('anon should execute the eight public readers, got %s', n);
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.proname in ('daily_my_entries', 'daily_alltime_mine', 'weekly_my_entries')
    and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'));
  assert n = 0, 'the "mine" readers are for signed-in callers only';
end $t$;

\echo '--- profiles: owner-only, unique ignoring case, guests refused, no user ids for anon'
do $t$ begin
  perform test.act('authenticated', '11111111-1111-4111-8111-111111111111');
  insert into public.profiles (user_id, display_name, country) values ('11111111-1111-4111-8111-111111111111', 'Minh H', 'VN');
  assert test.try($$insert into public.profiles (user_id, display_name) values ('22222222-2222-4222-8222-222222222222', 'Spoof')$$) like '42501%', 'insert for another user';
  assert test.try($$update public.profiles set user_id = '22222222-2222-4222-8222-222222222222'$$) like '42501%', 'user_id is not updatable';
end $t$;
do $t$ begin
  perform test.act('authenticated', '22222222-2222-4222-8222-222222222222');
  assert (select count(*) from public.profiles) = 0, 'B sees A''s profile';
  assert test.try($$insert into public.profiles (user_id, display_name) values ('22222222-2222-4222-8222-222222222222', 'minh h')$$) like '23505%', 'name taken ignoring case';
  assert test.try($$insert into public.profiles (user_id, display_name) values ('22222222-2222-4222-8222-222222222222', '  x')$$) like '23514%', 'shape check';
  assert test.try($$insert into public.profiles (user_id, display_name, country) values ('22222222-2222-4222-8222-222222222222', 'Bob the Builder', 'gb')$$) like '23514%', 'country must be two upper-case letters';
  assert test.try($$insert into public.profiles (user_id, display_name, country) values ('22222222-2222-4222-8222-222222222222', 'Bob the Builder', 'GBR')$$) like '23514%', 'country is alpha-2';
  insert into public.profiles (user_id, display_name) values ('22222222-2222-4222-8222-222222222222', 'Bob the Builder');
  update public.profiles set country = 'GB';
  assert (select country from public.profiles) = 'GB', 'owner sets a country';
end $t$;
do $t$ begin
  perform test.act('authenticated', '44444444-4444-4444-8444-444444444444', true);
  assert test.try($$insert into public.profiles (user_id, display_name) values ('44444444-4444-4444-8444-444444444444', 'Guesty')$$) like '42501%', 'guest profile';
end $t$;
do $t$ begin
  perform test.act('anon', null);
  assert test.try($$select * from public.profiles$$) like '42501%', 'anon reads profiles';
  assert test.try($$select * from private.daily_entries$$) like '42501%', 'anon reads private entries';
  assert test.try($$select * from private.daily_totals$$) like '42501%', 'anon reads private totals';
  assert test.try($$select * from private.weekly_entries$$) like '42501%', 'anon reads private weekly entries';
end $t$;

\echo '--- storage: owner folders, name shape, no guests, object cap'
do $t$ begin
  perform test.act('authenticated', '11111111-1111-4111-8111-111111111111');
  insert into storage.objects (bucket_id, name) values ('saves', '11111111-1111-4111-8111-111111111111/quick/1000-aaaaaaaaaaaaaaaa.json.gz');
  insert into storage.objects (bucket_id, name) values ('saves', '11111111-1111-4111-8111-111111111111/quick/1001-bbbbbbbbbbbbbbbb.json.gz');
  insert into storage.objects (bucket_id, name) values ('saves', '11111111-1111-4111-8111-111111111111/quick/1002-cccccccccccccccc.json.gz');
  insert into storage.objects (bucket_id, name) values ('saves', '11111111-1111-4111-8111-111111111111/quick/1003-dddddddddddddddd.json.gz');
  assert test.try($$insert into storage.objects (bucket_id, name) values ('saves', '22222222-2222-4222-8222-222222222222/quick/1-aaaaaaaaaaaaaaaa.json.gz')$$) like '42501%', 'upload into another folder';
  assert test.try($$insert into storage.objects (bucket_id, name) values ('saves', '11111111-1111-4111-8111-111111111111/other/1-aaaaaaaaaaaaaaaa.json.gz')$$) like '42501%', 'unknown slot folder';
  assert test.try($$insert into storage.objects (bucket_id, name) values ('packs', 'v/2026-10-24/leagues.json')$$) like '42501%', 'client upload into packs';
  assert test.try($$update storage.objects set name = name || 'x' where bucket_id = 'saves'$$) = 'ok', 'update runs';
  assert (select count(*) from storage.objects where name like '%x') = 0, 'objects are immutable for clients';
end $t$;
do $t$ begin
  perform test.act('authenticated', '44444444-4444-4444-8444-444444444444', true);
  assert test.try($$insert into storage.objects (bucket_id, name) values ('saves', '44444444-4444-4444-8444-444444444444/quick/1-aaaaaaaaaaaaaaaa.json.gz')$$) like '42501%', 'guest upload';
end $t$;
do $t$ declare i int; r text; begin
  perform test.act('authenticated', '33333333-3333-4333-8333-333333333333');
  for i in 1 .. 16 loop
    insert into storage.objects (bucket_id, name) values ('saves', format('33333333-3333-4333-8333-333333333333/season/%s-0123456789abcdef.json.gz', i));
  end loop;
  r := test.try($$insert into storage.objects (bucket_id, name) values ('saves', '33333333-3333-4333-8333-333333333333/season/99-0123456789abcdef.json.gz')$$);
  assert r like '42501%', 'the 17th object is refused: ' || r;
  assert (select count(*) from storage.objects) = 16, 'C sees only its own objects';
end $t$;

\echo '--- cloud saves: compare-and-set, previous copy, obsolete objects, tombstones'
do $t$ declare r jsonb; h1 text := repeat('1', 64); h2 text := repeat('2', 64); h3 text := repeat('3', 64); begin
  perform test.act('authenticated', '11111111-1111-4111-8111-111111111111');
  r := public.save_claim('quick', 0, 'g1', h1, '11111111-1111-4111-8111-111111111111/quick/1000-aaaaaaaaaaaaaaaa.json.gz', 100, 1000, '{"mode":"quick"}', 'device-aaaa', now());
  assert r->>'status' = 'ok' and (r->>'revision')::int = 1, 'first claim ' || r;
  r := public.save_claim('quick', 0, 'g1', h2, '11111111-1111-4111-8111-111111111111/quick/1001-bbbbbbbbbbbbbbbb.json.gz', 100, 1000, '{}', 'device-bbbb', now());
  assert r->>'status' = 'conflict' and (r->>'revision')::int = 1, 'stale base ' || r;
  r := public.save_claim('quick', 1, 'g1', h1, '11111111-1111-4111-8111-111111111111/quick/1001-bbbbbbbbbbbbbbbb.json.gz', 100, 1000, '{}', 'device-aaaa', now());
  assert r->>'status' = 'unchanged' and r->'obsolete' = '["11111111-1111-4111-8111-111111111111/quick/1001-bbbbbbbbbbbbbbbb.json.gz"]', 'identical content ' || r;
  r := public.save_claim('quick', 1, 'g1', h2, '11111111-1111-4111-8111-111111111111/quick/1001-bbbbbbbbbbbbbbbb.json.gz', 100, 1000, '{}', 'device-aaaa', now());
  assert r->>'status' = 'ok' and (r->>'revision')::int = 2 and r->'obsolete' = '[]', 'second claim ' || r;
  r := public.save_claim('quick', 2, 'g1', h3, '11111111-1111-4111-8111-111111111111/quick/1002-cccccccccccccccc.json.gz', 100, 1000, '{}', 'device-aaaa', now());
  assert r->>'status' = 'ok' and r->'obsolete' = '["11111111-1111-4111-8111-111111111111/quick/1000-aaaaaaaaaaaaaaaa.json.gz"]', 'third claim drops the oldest ' || r;
  assert (select prev_object_path from public.cloud_saves where slot = 'quick') like '%1001-bbbb%', 'previous copy kept';
  r := public.save_claim('quick', 3, 'g1', repeat('4', 64), '11111111-1111-4111-8111-111111111111/quick/1003-dddddddddddddddd.json.gz', 100, 1000, '{}', 'device-aaaa', now(), true);
  assert r->>'status' = 'archived' and (r->>'revision')::int = 3 and r->'obsolete' = '["11111111-1111-4111-8111-111111111111/quick/1001-bbbbbbbbbbbbbbbb.json.gz"]', 'kept as previous ' || r;
  assert test.try($$select public.save_claim('quick', 3, 'g1', repeat('5', 64), '11111111-1111-4111-8111-111111111111/quick/9999-eeeeeeeeeeeeeeee.json.gz', 1, 1, '{}', 'device-aaaa', now())$$) like '22023%', 'claim before upload';
  assert test.try($$select public.save_claim('quick', 3, 'g1', repeat('5', 64), '22222222-2222-4222-8222-222222222222/quick/1-aaaaaaaaaaaaaaaa.json.gz', 1, 1, '{}', 'device-aaaa', now())$$) like '22023%', 'claim of a foreign object';
  assert test.try($$insert into public.cloud_saves (user_id, slot, revision, game_id, content_hash, object_path, bytes, raw_bytes, device_id) values ('11111111-1111-4111-8111-111111111111', 'season', 99, 'x', repeat('a', 64), 'p', 1, 1, 'device-aaaa')$$) like '42501%', 'direct insert';
  assert test.try($$update public.cloud_saves set revision = 999$$) like '42501%', 'direct update';
  r := public.save_delete('quick', 3, 'device-aaaa');
  assert r->>'status' = 'ok' and (r->>'revision')::int = 4, 'tombstone ' || r;
  assert (select deleted_at is not null and object_path is null and game_id = 'g1' and prev_object_path like '%1002-cccc%' from public.cloud_saves where slot = 'quick'), 'tombstone keeps id and copy';
  r := public.save_claim('quick', 4, 'g2', repeat('6', 64), '11111111-1111-4111-8111-111111111111/quick/1001-bbbbbbbbbbbbbbbb.json.gz', 100, 1000, '{}', 'device-aaaa', now());
  assert r->>'status' = 'ok' and (r->>'revision')::int = 5, 'new game over a tombstone ' || r;
end $t$;
do $t$ begin
  perform test.act('anon', null);
  assert test.try($$select public.save_claim('quick', 0, 'g', repeat('1', 64), 'x', 1, 1, '{}', 'device-xxxx', now())$$) like '42501%', 'anon cannot call save_claim';
end $t$;
do $t$ begin
  perform test.act('authenticated', '44444444-4444-4444-8444-444444444444', true);
  assert test.try($$select public.save_claim('quick', 0, 'g', repeat('1', 64), '44444444-4444-4444-8444-444444444444/quick/1-aaaaaaaaaaaaaaaa.json.gz', 1, 1, '{}', 'device-xxxx', now())$$) like 'PT403%', 'guest claim';
end $t$;
do $t$ begin
  perform test.act('authenticated', '22222222-2222-4222-8222-222222222222');
  assert (select count(*) from public.cloud_saves) = 0, 'B sees A''s saves';
end $t$;

\echo '--- cloud saves: orphan sweep list and the claim rate limit'
update storage.objects set created_at = now() - interval '1 hour';
do $t$ declare n int; begin
  perform test.act('authenticated', '11111111-1111-4111-8111-111111111111');
  select count(*) into n from public.save_orphans();
  assert n = 2, format('expected 2 orphans (1000-aaaa, 1003 was archived then dropped? got %s)', n);
end $t$;
select o as orphan from (select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false)) x, public.save_orphans() o;
select set_config('request.jwt.claims', '', false);
do $t$ declare i int; r text; begin
  perform test.act('authenticated', '33333333-3333-4333-8333-333333333333');
  perform public.save_claim('season', 0, 'g', repeat('a', 64), '33333333-3333-4333-8333-333333333333/season/1-0123456789abcdef.json.gz', 1, 1, '{}', 'device-cccc', now());
  for i in 1 .. 58 loop
    perform public.save_claim('season', i, 'g', repeat('a', 63) || (i % 10)::text, format('33333333-3333-4333-8333-333333333333/season/%s-0123456789abcdef.json.gz', (i % 15) + 2), 1, 1, '{}', 'device-cccc', now());
  end loop;
  r := test.try($$select public.save_claim('season', 59, 'g', repeat('b', 64), '33333333-3333-4333-8333-333333333333/season/2-0123456789abcdef.json.gz', 1, 1, '{}', 'device-cccc', now())$$);
  assert r = 'ok', 'the 60th claim is allowed: ' || r;
  r := test.try($$select public.save_claim('season', 60, 'g', repeat('c', 64), '33333333-3333-4333-8333-333333333333/season/3-0123456789abcdef.json.gz', 1, 1, '{}', 'device-cccc', now())$$);
  assert r like 'PT429%', 'the 61st claim in an hour is refused: ' || r;
end $t$;

\echo '--- cloud profile: compare-and-set'
do $t$ declare r jsonb; begin
  perform test.act('authenticated', '11111111-1111-4111-8111-111111111111');
  r := public.profile_put(0, '{"v":1,"profile":{"gamesPlayed":1}}', 'device-aaaa');
  assert r->>'status' = 'ok' and (r->>'revision')::int = 1, r::text;
  r := public.profile_put(0, '{"v":1,"profile":{"gamesPlayed":2}}', 'device-bbbb');
  assert r->>'status' = 'conflict' and r->'data'->'profile'->>'gamesPlayed' = '1', r::text;
  r := public.profile_put(1, '{"v":1,"profile":{"gamesPlayed":2}}', 'device-bbbb');
  assert r->>'status' = 'ok' and (r->>'revision')::int = 2, r::text;
  r := public.profile_put(1, '{"v":1,"profile":{"gamesPlayed":2}}', 'device-aaaa');
  assert r->>'status' = 'unchanged', r::text;
end $t$;

\echo '--- daily: pins and entries are service-only; figures checks allow 42-game seasons'
do $t$ begin
  perform test.act('authenticated', '11111111-1111-4111-8111-111111111111');
  assert test.try($$select public.svc_daily_pin(current_date, '{}', 'h', '3', '2026-10-24')$$) like '42501%', 'client pins';
  assert test.try($$select public.svc_daily_submit('11111111-1111-4111-8111-111111111111', current_date, '{}')$$) like '42501%', 'client submits';
  assert test.try($$insert into public.daily_puzzles (puzzle_date, seed, settings, settings_hash, engine_version, data_version) values (current_date, 'daily-x', '{}', 'h', '3', 'd')$$) like '42501%', 'client inserts a pin';
end $t$;
create temp table today_ as select (now() at time zone 'UTC')::date as d;
grant select on today_ to service_role, anon, authenticated;
do $t$
declare
  d date := (select d from today_);
  r jsonb;
  e jsonb := '{"team_name":"Touchline XI","points":80,"won":24,"drawn":8,"lost":6,"goals_for":70,"goals_against":35,"league_position":2,"tier":"TITLE_RACE","payload":"eyJ2IjoxLCJkYXRhIjoiMjAyNi0xMC0yNCIsImVuZ2luZSI6IjMifQxxxxxx","xi":["a","b","c","d","e","f","g","h","i","j","k"],"history_key":"k1","draft_fingerprint":"f1","claim_matched":true,"engine_version":"3","data_version":"2026-10-24"}';
begin
  perform test.act('service_role', null);
  r := to_jsonb(public.svc_daily_pin(d, '{"mode":"daily"}', 'abc', '3', '2026-10-24'));
  assert r->>'seed' = 'daily-' || to_char(d, 'YYYY-MM-DD'), r::text;
  r := to_jsonb(public.svc_daily_pin(d, '{"mode":"other"}', 'zzz', '4', '2099-01-01'));
  assert r->>'settings_hash' = 'abc', 'a pin never changes';
  r := public.svc_daily_submit('11111111-1111-4111-8111-111111111111', d, e);
  assert r->>'status' = 'ranked' and (r->>'position')::int = 1, r::text;
  r := public.svc_daily_submit('11111111-1111-4111-8111-111111111111', d, e);
  assert r->>'status' = 'duplicate', r::text;
  r := public.svc_daily_submit('11111111-1111-4111-8111-111111111111', d, jsonb_set(jsonb_set(e, '{draft_fingerprint}', '"f2"'), '{points}', '99'));
  assert r->>'status' = 'already_submitted' and r->'entry'->>'points' = '80', 'first entry stands ' || r;
  -- B posts the same figures later: ranks below A (first post wins the tie)
  r := public.svc_daily_submit('22222222-2222-4222-8222-222222222222', d, e);
  assert r->>'status' = 'ranked' and (r->>'position')::int = 2, 'tie goes to the earlier post ' || r;
  -- C: a 42-game season (22 clubs) with 23-11-8
  r := public.svc_daily_submit('33333333-3333-4333-8333-333333333333', d, e || '{"points":80,"won":23,"drawn":11,"lost":8,"goals_for":90,"goals_against":30,"league_position":3,"tier":"EUROPEAN","draft_fingerprint":"f3"}');
  assert r->>'status' = 'ranked' and (r->>'position')::int = 3, '42 games accepted, more defeats ranks lower ' || r;
  assert test.try(format($q$select public.svc_daily_submit('44444444-4444-4444-8444-444444444444', %L, %L)$q$, d, e || '{"points":81}')) like '23514%', 'points must equal 3w + d';
  r := public.svc_daily_submit('44444444-4444-4444-8444-444444444444', d - 3, e);
  assert r->>'status' = 'closed', r::text;
  r := public.svc_daily_submit('44444444-4444-4444-8444-444444444444', d - 1, e);
  assert r->>'status' = 'no_puzzle', r::text;
end $t$;
-- a finished day three days back, written directly as the owner would see it after the window
insert into public.daily_puzzles (puzzle_date, seed, settings, settings_hash, engine_version, data_version)
select d - 3, 'daily-' || to_char(d - 3, 'YYYY-MM-DD'), '{}', 'old', '3', '2026-10-24' from today_;
insert into private.daily_entries (puzzle_date, user_id, display_name, team_name, points, won, drawn, lost, goals_for, goals_against, league_position, tier, payload, xi, history_key, draft_fingerprint, claim_matched, engine_version, data_version)
select d - 3, '11111111-1111-4111-8111-111111111111', 'Minh H', 'Old XI', 70, 20, 10, 8, 60, 40, 4, 'EUROPEAN', repeat('A', 60), array['a','b','c','d','e','f','g','h','i','j','k'], 'k', 'f', false, '3', '2026-10-24' from today_;

\echo '--- daily: the public board (anon) shows names and figures, never user ids; picks only after close'
do $t$ declare d date := (select d from today_); n int; begin
  perform test.act('anon', null);
  assert (select count(*) from public.daily_board(d)) = 3, 'three rows today';
  assert (select bool_and(payload is null and xi is null and not revealed and not is_me) from public.daily_board(d)), 'picks hidden while posts are open';
  assert (select string_agg(display_name, ',' order by board_position) from public.daily_board(d)) like 'Minh H,Bob the Builder,Manager %', 'order and name snapshots';
  assert (select bool_and(revealed and payload is not null and xi is not null) from public.daily_board(d - 3)), 'revealed after the window';
  assert (select played from public.daily_summary(d)) = 3 and (select my_position from public.daily_summary(d)) is null, 'anon summary';
  assert public.daily_rank(d, 80, 6, 35, 70) = 3, 'a hypothetical tie goes after the equal rows, before a row with more defeats';
  assert public.daily_rank(d, 100, 0, 80, 100) = 1, 'a better result would be first';
  assert test.try($$select public.daily_my_entries()$$) like '42501%', 'anon has no own entries';
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'daily_board';
end $t$;
do $t$ declare d date := (select d from today_); begin
  perform test.act('authenticated', '22222222-2222-4222-8222-222222222222');
  assert (select my_position from public.daily_summary(d)) = 2, 'B is second';
  assert (select count(*) from public.daily_board(d) where is_me) = 1, 'B sees its own row flagged';
  assert (select count(*) from public.daily_my_entries()) = 1, 'B has one entry';
end $t$;
select board_position, display_name, team_name, points, won, drawn, lost, goal_diff, revealed from public.daily_board((select d from today_));

\echo '--- daily: every board takes a country (copied from the profile when the entry was posted)'
do $t$ declare d date := (select d from today_); begin
  perform test.act('anon', null);
  assert (select string_agg(coalesce(country, '-'), ',' order by board_position) from public.daily_board(d)) = 'VN,GB,-', 'country snapshots';
  assert (select count(*) from public.daily_board(d, 50, 0, 'GB')) = 1 and (select board_position from public.daily_board(d, 50, 0, 'gb')) = 1, 'GB board, any case';
  assert (select display_name from public.daily_board(d, 50, 0, 'VN')) = 'Minh H', 'VN board';
  assert (select count(*) from public.daily_board(d, 50, 0, 'ZZ')) = 0, 'unknown country: empty board';
  assert (select played from public.daily_summary(d, 'GB')) = 1, 'country summary';
  assert public.daily_rank(d, 80, 6, 35, 70, 'GB') = 2 and public.daily_rank(d, 80, 6, 35, 70, 'FR') = 1, 'country rank';
end $t$;
do $t$ declare d date := (select d from today_); begin
  perform test.act('authenticated', '22222222-2222-4222-8222-222222222222');
  assert (select my_position from public.daily_summary(d, 'GB')) = 1, 'B is first in GB';
  perform test.act('authenticated', '11111111-1111-4111-8111-111111111111');
  assert (select my_position from public.daily_summary(d, 'GB')) is null, 'A is not on the GB board';
end $t$;

\echo '--- world: all-time Daily totals and best streak, rebuilt from the entries'
insert into public.daily_puzzles (puzzle_date, seed, settings, settings_hash, engine_version, data_version)
select x, 'daily-' || to_char(x, 'YYYY-MM-DD'), '{}', 'h', '3', '2026-10-24' from today_, lateral (values (d - 1), (d - 2)) v(x);
do $t$
declare
  d date := (select d from today_);
  r jsonb;
  e jsonb := '{"team_name":"Touchline XI","points":80,"won":24,"drawn":8,"lost":6,"goals_for":70,"goals_against":35,"league_position":2,"tier":"TITLE_RACE","payload":"eyJ2IjoxLCJkYXRhIjoiMjAyNi0xMC0yNCIsImVuZ2luZSI6IjMifQxxxxxx","xi":["a","b","c","d","e","f","g","h","i","j","k"],"history_key":"k1","draft_fingerprint":"f9","claim_matched":true,"engine_version":"3","data_version":"2026-10-24"}';
begin
  perform test.act('service_role', null);
  r := public.svc_daily_submit('11111111-1111-4111-8111-111111111111', d - 1, e);
  assert r->>'status' = 'ranked' and r->>'country' = 'VN' and (r->>'countryPosition')::int = 1, 'yesterday posted ' || r;
  -- d - 3 (written directly above) is picked up by the rebuild: 80 + 80 + 70, best run d-1..d
  assert (select total_points = 230 and played = 3 and best_streak = 2 and last_streak = 2 and last_date = d and country = 'VN' from private.daily_totals where user_id = '11111111-1111-4111-8111-111111111111'), 'A totals after yesterday';
  assert (select total_points = 80 and played = 1 and best_streak = 1 from private.daily_totals where user_id = '22222222-2222-4222-8222-222222222222'), 'B totals';
end $t$;
insert into private.daily_entries (puzzle_date, user_id, display_name, team_name, points, won, drawn, lost, goals_for, goals_against, league_position, tier, payload, xi, history_key, draft_fingerprint, claim_matched, engine_version, data_version)
select d - 2, '11111111-1111-4111-8111-111111111111', 'Minh H', 'Old XI', 70, 20, 10, 8, 60, 40, 4, 'EUROPEAN', repeat('A', 60), array['a','b','c','d','e','f','g','h','i','j','k'], 'k', 'f', false, '3', '2026-10-24' from today_;
do $t$ declare d date := (select d from today_); begin
  perform test.act('authenticated', '11111111-1111-4111-8111-111111111111');
  assert test.try($$select public.svc_daily_totals_refresh('11111111-1111-4111-8111-111111111111')$$) like '42501%', 'clients cannot refresh totals';
  perform test.act('service_role', null);
  perform public.svc_daily_totals_refresh('11111111-1111-4111-8111-111111111111');
  assert (select total_points = 300 and played = 4 and best_streak = 4 and last_streak = 4 from private.daily_totals where user_id = '11111111-1111-4111-8111-111111111111'), 'four days running';
  update private.daily_entries set hidden = true where user_id = '11111111-1111-4111-8111-111111111111' and puzzle_date = d - 2;
  perform public.svc_daily_totals_refresh('11111111-1111-4111-8111-111111111111');
  assert (select total_points = 230 and played = 3 and best_streak = 2 from private.daily_totals where user_id = '11111111-1111-4111-8111-111111111111'), 'a hidden entry leaves the totals';
end $t$;
do $t$ begin
  perform test.act('anon', null);
  assert (select string_agg(display_name, ',' order by board_position) from public.daily_alltime_board()) like 'Minh H,Bob the Builder,Manager %', 'all-time by points, ties to who got there first';
  assert (select total_points = 230 and played = 3 and average_points = 76.7 and best_streak = 2 and current_streak = 2 and not is_me from public.daily_alltime_board() where board_position = 1), 'all-time row';
  assert (select display_name from public.daily_alltime_board('streak') where board_position = 1) = 'Minh H', 'all-time by best streak';
  assert (select count(*) from public.daily_alltime_board('points', 'GB')) = 1 and (select board_position from public.daily_alltime_board('points', 'GB')) = 1, 'GB all-time board';
  assert (select display_name from public.daily_alltime_board('streak', 'vn')) = 'Minh H', 'VN streak board';
  assert (select count(*) from public.daily_alltime_board('points', null, 1, 1)) = 1, 'paging';
  assert test.try($$select * from public.daily_alltime_mine()$$) like '42501%', 'anon has no all-time row';
end $t$;
do $t$ begin
  perform test.act('authenticated', '22222222-2222-4222-8222-222222222222');
  assert (select board_position = 2 and players = 3 and total_points = 80 from public.daily_alltime_mine()), 'B second of three';
  assert (select board_position = 1 and players = 1 from public.daily_alltime_mine('points', 'GB')), 'B first in GB';
  assert (select count(*) from public.daily_alltime_board() where is_me) = 1, 'B sees its own all-time row flagged';
  perform test.act('authenticated', '33333333-3333-4333-8333-333333333333');
  assert (select board_position from public.daily_alltime_mine('streak')) = 3, 'C third by streak (ties on 1, behind B on time)';
end $t$;

\echo '--- weekly: a fixed seed per ISO week, service-only pins and posts, first post stands, country filter'
create temp table week_ as select d - (extract(isodow from d)::int - 1) as w from today_;
grant select on week_ to service_role, anon, authenticated;
do $t$ declare w date := (select w from week_); begin
  perform test.act('authenticated', '11111111-1111-4111-8111-111111111111');
  assert test.try(format($q$select public.svc_weekly_pin(%L, '{}', 'h', '3', '2026-10-24')$q$, w)) like '42501%', 'client pins a week';
  assert test.try(format($q$select public.svc_weekly_submit('11111111-1111-4111-8111-111111111111', %L, '{}')$q$, w)) like '42501%', 'client posts a week';
  assert test.try(format($q$insert into public.weekly_puzzles (week_start, week_key, seed, settings, settings_hash, engine_version, data_version) values (%L, 'x', 'weekly-x', '{}', 'h', '3', 'd')$q$, w)) like '42501%', 'client inserts a weekly pin';
end $t$;
do $t$
declare
  w date := (select w from week_);
  r jsonb;
  e jsonb := '{"team_name":"Touchline XI","points":75,"won":22,"drawn":9,"lost":7,"goals_for":66,"goals_against":38,"league_position":3,"tier":"EUROPEAN","payload":"eyJ2IjoxLCJkYXRhIjoiMjAyNi0xMC0yNCIsImVuZ2luZSI6IjMifQxxxxxx","xi":["a","b","c","d","e","f","g","h","i","j","k"],"history_key":"k1","draft_fingerprint":"w1","claim_matched":true,"engine_version":"3","data_version":"2026-10-24"}';
begin
  perform test.act('service_role', null);
  r := public.svc_weekly_submit('11111111-1111-4111-8111-111111111111', w, e);
  assert r->>'status' = 'no_puzzle', 'no pin yet ' || r;
  r := to_jsonb(public.svc_weekly_pin(w, '{"mode":"quick"}', 'wk', '3', '2026-10-24'));
  assert r->>'week_key' = to_char(w, 'IYYY-"W"IW') and r->>'seed' = 'weekly-' || to_char(w, 'IYYY-"W"IW'), r::text;
  r := to_jsonb(public.svc_weekly_pin(w, '{"mode":"other"}', 'zz', '9', '2099-01-01'));
  assert r->>'settings_hash' = 'wk', 'a weekly pin never changes';
  assert test.try(format($q$select public.svc_weekly_pin(%L, '{}', 'h', '3', 'd')$q$, w + 2)) like '23514%', 'a week starts on a Monday';
  r := public.svc_weekly_submit('11111111-1111-4111-8111-111111111111', w, e);
  assert r->>'status' = 'ranked' and (r->>'position')::int = 1 and r->>'country' = 'VN', r::text;
  r := public.svc_weekly_submit('11111111-1111-4111-8111-111111111111', w, e);
  assert r->>'status' = 'duplicate', r::text;
  r := public.svc_weekly_submit('11111111-1111-4111-8111-111111111111', w, e || '{"draft_fingerprint":"w2","points":90,"won":28,"drawn":6,"lost":4}');
  assert r->>'status' = 'already_submitted' and r->'entry'->>'points' = '75', 'first weekly post stands ' || r;
  r := public.svc_weekly_submit('22222222-2222-4222-8222-222222222222', w, e || '{"draft_fingerprint":"w3","points":81,"won":25,"drawn":6,"lost":7}');
  assert r->>'status' = 'ranked' and (r->>'position')::int = 1 and (r->>'total')::int = 2 and (r->>'countryPosition')::int = 1, 'B leads the week ' || r;
  r := public.svc_weekly_submit('33333333-3333-4333-8333-333333333333', w + 7, e);
  assert r->>'status' = 'closed', 'next week is not open yet ' || r;
  r := public.svc_weekly_submit('33333333-3333-4333-8333-333333333333', w - 14, e);
  assert r->>'status' = 'closed', 'a past week is closed ' || r;
  assert test.try(format($q$select public.svc_weekly_submit('33333333-3333-4333-8333-333333333333', %L, %L)$q$, w, e || '{"points":76}')) like '23514%', 'weekly points must equal 3w + d';
end $t$;
insert into public.weekly_puzzles (week_start, week_key, seed, settings, settings_hash, engine_version, data_version)
select w - 14, to_char(w - 14, 'IYYY-"W"IW'), 'weekly-' || to_char(w - 14, 'IYYY-"W"IW'), '{}', 'old', '3', '2026-10-24' from week_;
insert into private.weekly_entries (week_start, user_id, display_name, country, team_name, points, won, drawn, lost, goals_for, goals_against, league_position, tier, payload, xi, history_key, draft_fingerprint, claim_matched, engine_version, data_version)
select w - 14, '22222222-2222-4222-8222-222222222222', 'Bob the Builder', 'GB', 'Old XI', 70, 20, 10, 8, 60, 40, 4, 'EUROPEAN', repeat('A', 60), array['a','b','c','d','e','f','g','h','i','j','k'], 'k', 'f', true, '3', '2026-10-24' from week_;
do $t$ declare w date := (select w from week_); begin
  perform test.act('anon', null);
  assert (select string_agg(display_name, ',' order by board_position) from public.weekly_board(w)) = 'Bob the Builder,Minh H', 'weekly order';
  assert (select bool_and(payload is null and xi is null and not revealed and not is_me) from public.weekly_board(w)), 'weekly picks hidden while posts are open';
  assert (select bool_and(revealed and payload is not null) from public.weekly_board(w - 14)), 'weekly picks revealed after the grace day';
  assert (select display_name from public.weekly_board(w, 50, 0, 'VN')) = 'Minh H' and (select board_position from public.weekly_board(w, 50, 0, 'VN')) = 1, 'weekly VN board';
  assert (select played = 2 and top_points = 81 and posts_open from public.weekly_summary(w)), 'weekly summary';
  assert (select played from public.weekly_summary(w, 'GB')) = 1, 'weekly GB summary';
  assert public.weekly_rank(w, 80, 5, 30, 60) = 2 and public.weekly_rank(w, 80, 5, 30, 60, 'VN') = 1, 'weekly rank, with a country';
  assert test.try($$select * from public.weekly_my_entries()$$) like '42501%', 'anon has no weekly entries';
end $t$;
do $t$ declare w date := (select w from week_); begin
  perform test.act('authenticated', '11111111-1111-4111-8111-111111111111');
  assert (select my_position from public.weekly_summary(w)) = 2 and (select my_position from public.weekly_summary(w, 'VN')) = 1, 'A second, first in VN';
  assert (select count(*) = 1 and min(week_key) = to_char(w, 'IYYY-"W"IW') from public.weekly_my_entries()), 'A has one weekly entry';
  assert (select count(*) from public.weekly_board(w) where is_me) = 1, 'A sees its own weekly row flagged';
end $t$;

\echo '--- challenges: create via function only, idempotent, resolvable by exact code, never listable'
create temp table pay as select '{"v":1,"data":"2026-10-24","engine":"3","name":"Minh","s":{"seed":"K7Q2-MX9A","f":"4-3-3","l":"england","wl":["england"],"h":"burnley","ls":2017,"d":"calibrated","r":{}},"p":[["s200458","GK"],[null,null]],"c":{"pts":80,"w":24,"d":8,"l":6,"t":"TITLE_RACE"},"k":"abc"}'::jsonb as p;
grant select on pay to anon, authenticated, service_role;
create temp table codes (code text);
grant select, insert on codes to anon, authenticated, service_role;
do $t$ declare c1 text; c2 text; begin
  perform test.act('authenticated', '11111111-1111-4111-8111-111111111111');
  c1 := public.create_challenge((select p from pay));
  c2 := public.create_challenge((select p from pay));
  assert c1 = c2 and c1 ~ '^[A-HJ-NP-Z2-9]{8}$', 'same payload, same code';
  insert into codes values (c1);
  assert public.create_challenge((select p || '{"x":{"t":{"mentality":"attacking"}}}' from pay)) <> c1, 'the x block is allowed';
  assert test.try($$select public.create_challenge('{"v":1}'::jsonb)$$) like '22023%', 'not a challenge';
  assert test.try($$select public.create_challenge((select p || '{"evil":1}' from pay))$$) like '22023%', 'unknown key';
  assert test.try($$insert into public.challenges (code, owner_id, payload) values ('AAAAAAAA', '11111111-1111-4111-8111-111111111111', (select p from pay))$$) like '42501%', 'no direct insert';
  assert (select count(*) from public.challenges) = 2, 'owner lists own codes';
end $t$;
do $t$ begin
  perform test.act('authenticated', '44444444-4444-4444-8444-444444444444', true);
  assert test.try($$select public.create_challenge((select p from pay))$$) like 'PT403%', 'guest code';
end $t$;
do $t$ declare c text := (select code from codes); begin
  perform test.act('anon', null);
  assert public.get_challenge(lower(substr(c, 1, 4)) || '-' || lower(substr(c, 5))) ->> 'name' = 'Minh', 'resolve typed code';
  assert public.get_challenge('ZZZZZZZZ') is null, 'unknown code';
  assert test.try($$select count(*) from public.challenges$$) like '42501%', 'anon cannot list';
  assert test.try($$select public.create_challenge('{}'::jsonb)$$) like '42501%', 'anon cannot create';
end $t$;
do $t$ begin
  perform test.act('authenticated', '22222222-2222-4222-8222-222222222222');
  assert (select count(*) from public.challenges) = 0, 'B cannot list A''s codes';
  delete from public.challenges;
end $t$;
select count(*) as a_codes_after_b_delete from public.challenges;

\echo '--- account deletion cascades through every Phase 1 table'
delete from storage.objects where name like '11111111-%';
delete from auth.users where id = '11111111-1111-4111-8111-111111111111';
select (select count(*) from public.profiles where user_id = '11111111-1111-4111-8111-111111111111') as profiles,
       (select count(*) from public.cloud_saves where user_id = '11111111-1111-4111-8111-111111111111') as saves,
       (select count(*) from public.cloud_profile where user_id = '11111111-1111-4111-8111-111111111111') as cloud_profile,
       (select count(*) from private.daily_entries where user_id = '11111111-1111-4111-8111-111111111111') as entries,
       (select count(*) from private.daily_totals where user_id = '11111111-1111-4111-8111-111111111111') as totals,
       (select count(*) from private.weekly_entries where user_id = '11111111-1111-4111-8111-111111111111') as weekly,
       (select count(*) from public.challenges where owner_id = '11111111-1111-4111-8111-111111111111') as challenges;
do $t$ begin
  assert not exists (select 1 from public.profiles where user_id = '11111111-1111-4111-8111-111111111111')
     and not exists (select 1 from public.cloud_saves where user_id = '11111111-1111-4111-8111-111111111111')
     and not exists (select 1 from private.daily_entries where user_id = '11111111-1111-4111-8111-111111111111')
     and not exists (select 1 from private.daily_totals where user_id = '11111111-1111-4111-8111-111111111111')
     and not exists (select 1 from private.weekly_entries where user_id = '11111111-1111-4111-8111-111111111111')
     and not exists (select 1 from public.challenges where owner_id = '11111111-1111-4111-8111-111111111111'), 'deletion cascades';
end $t$;
\echo 'PHASE 1 ASSERTIONS PASSED'

-- The casual boards (migration casual_boards): the Daily Arena, the Weekly Challenge (mode weekly) and the Run-in of
-- the week. Pins (the first stands), one post per account per board and period, the figures each board allows, the
-- board order (arena: steps won, goal difference, fewer conceded; a league: points, fewer defeats, goal difference),
-- the reveal once posting closes, country filters, and nobody but service_role writing anything. Runs after
-- phase1.sql (which deletes Alice): uses Bob (GB) and two accounts of its own, removed at the end.
\set ON_ERROR_STOP on
\pset pager off

insert into auth.users (id, email, is_anonymous) values
  ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'erin@example.com', false),
  ('c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', 'finn@example.com', false);
insert into public.profiles (user_id, display_name, country) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'Erin', 'VN');

create temp table casual_keys as
select to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD') as today,
       to_char((now() at time zone 'UTC')::date - 1, 'YYYY-MM-DD') as yesterday,
       to_char((now() at time zone 'UTC')::date - 2, 'YYYY-MM-DD') as before,
       to_char((now() at time zone 'UTC')::date, 'IYYY-"W"IW') as week,
       to_char((now() at time zone 'UTC')::date - 14, 'IYYY-"W"IW') as old_week;
grant select on casual_keys to anon, authenticated, service_role;

\echo '--- casual: the client roles cannot pin, post or read the tables'
do $t$ begin
  perform test.act('authenticated', '22222222-2222-4222-8222-222222222222');
  assert test.try($$select public.svc_casual_pin('arena', '2026-10-27', '{}', 'h', '6', 'd')$$) like '42501%', 'client pins';
  assert test.try($$select public.svc_casual_get_pin('arena', '2026-10-27')$$) like '42501%', 'client reads a pin';
  assert test.try($$select public.svc_casual_submit('22222222-2222-4222-8222-222222222222', 'arena', '2026-10-27', '{}')$$) like '42501%', 'client posts';
  assert test.try($$select * from private.casual_entries$$) like '42501%', 'client reads entries';
  assert test.try($$select * from private.casual_puzzles$$) like '42501%', 'client reads puzzles';
  assert test.try($$select private.casual_position(1)$$) like '42501%', 'client calls a private helper';
  assert test.try($$select private.casual_start_of('arena', '2026-10-27')$$) like '42501%', 'client calls the key parser';
end $t$;
do $t$ begin
  perform test.act('anon', null);
  assert test.try($$select public.svc_casual_submit('22222222-2222-4222-8222-222222222222', 'arena', '2026-10-27', '{}')$$) like '42501%', 'anon posts';
  assert test.try($$select * from public.casual_my_entries()$$) like '42501%', 'anon has no entries';
  assert (select count(*) from public.casual_board('arena', (select today from casual_keys))) = 0, 'an empty board reads empty';
  assert (select played = 0 and top_score is null and my_position is null and posts_open and not revealed from public.casual_summary('arena', (select today from casual_keys))), 'an empty summary';
  assert test.try($$select * from public.casual_board('league', '2026-10-27')$$) like '22023%', 'an unknown board';
  assert test.try($$select * from public.casual_board('arena', '2026-W44')$$) like '22023%', 'an arena key is a day';
  assert test.try($$select * from public.casual_board('themed', '2026-10-27')$$) like '22023%', 'a week key is YYYY-Www';
  assert test.try($$select * from public.casual_board('arena', '2026-02-30')$$) like '22023%', 'a day that does not exist';
  assert test.try($$select * from public.casual_board('runin', '2026-W54')$$) like '22023%', 'a week that does not exist';
end $t$;

\echo '--- casual: keys and windows'
do $t$ begin
  perform test.act('service_role', null);
  assert private.casual_start_of('themed', '2026-W44') = '2026-10-26', 'W44 starts on Monday 26 October';
  assert private.casual_start_of('runin', '2027-W01') = '2027-01-04', 'ISO week one of 2027';
  assert private.casual_start_of('themed', '2026-W53') = '2026-12-28', '2026 has 53 weeks';
  assert private.casual_closes_at('arena', '2026-10-27') = '2026-10-29 00:00:00+00', 'a day closes two days on';
  assert private.casual_closes_at('runin', '2026-10-26') = '2026-11-03 00:00:00+00', 'a week closes on the Tuesday after';
  assert private.casual_is_open('arena', (now() at time zone 'UTC')::date - 1) and not private.casual_is_open('arena', (now() at time zone 'UTC')::date - 2), 'today and yesterday';
end $t$;

\echo '--- casual: pins, the first one stands'
do $t$ declare r jsonb; k casual_keys; begin
  perform test.act('service_role', null);
  select * into k from casual_keys;
  assert public.svc_casual_get_pin('arena', k.today) is null, 'no pin yet';
  r := public.svc_casual_pin('arena', k.today, '{"seed":"x","formationId":"4-3-3"}', 'hash1', '6', 'data-1');
  assert r->>'seed' = 'arena-' || k.today and r->>'key' = k.today and r->>'settingsHash' = 'hash1' and r->>'engineVersion' = '6', r::text;
  r := public.svc_casual_pin('arena', k.today, '{"seed":"y"}', 'hash2', '7', 'data-2');
  assert r->>'settingsHash' = 'hash1' and r->>'dataVersion' = 'data-1', 'the first pin stands ' || r;
  assert public.svc_casual_get_pin('arena', k.today)->>'settingsHash' = 'hash1', 'read back';
  r := public.svc_casual_pin('themed', k.week, '{"mode":"weekly"}', 'hash3', '6', 'data-1');
  assert r->>'seed' = 'weekly-' || k.week, r::text;
  r := public.svc_casual_pin('runin', k.week, '{"mode":"runin"}', 'hash4', '6', 'data-1');
  assert r->>'seed' = 'runin-' || k.week, r::text;
  perform public.svc_casual_pin('arena', k.before, '{}', 'hash5', '6', 'data-1');
  perform public.svc_casual_pin('arena', k.yesterday, '{}', 'hash6', '6', 'data-1');
  assert test.try($$select public.svc_casual_pin('arena', '2026-W44', '{}', 'h', '6', 'd')$$) like '22023%', 'a week key on the arena board';
  assert test.try($$select public.svc_casual_pin('quick', '2026-W44', '{}', 'h', '6', 'd')$$) like '22023%', 'an unknown board';
  assert test.try($$select public.svc_casual_pin('themed', '2026-W44', '[]', 'h', '6', 'd')$$) like '23514%', 'settings are an object';
end $t$;

\echo '--- casual: posts, one per account per board and period; the figures each board allows'
do $t$
declare
  r jsonb;
  k casual_keys;
  arena jsonb := '{"team_name":"Touchline XI","score":9,"won":9,"drawn":0,"lost":1,"goals_for":20,"goals_against":8,"league_position":null,"trophy":false,"detail":"9 rungs","payload":"eyJ2IjoyLCJraW5kIjoiYXJlbmEiLCJkYXRhIjoiMjAyNi0xMC0yNCJ9xxxxxx","xi":["a","b","c","d","e","f","g","h","i","j","k"],"history_key":"k1","draft_fingerprint":"f1","claim_matched":true,"engine_version":"6","data_version":"data-1"}';
  league jsonb := '{"team_name":"Weekly FC","score":80,"won":24,"drawn":8,"lost":6,"goals_for":70,"goals_against":30,"league_position":2,"trophy":false,"detail":"TITLE_RACE","payload":"eyJ2IjoyLCJraW5kIjoicXVpY2siLCJkYXRhIjoiMjAyNi0xMC0yNCJ9xxxxxx","xi":["a","b","c","d","e","f","g","h","i","j","k"],"history_key":"k2","draft_fingerprint":"f2","claim_matched":true,"engine_version":"6","data_version":"data-1"}';
  runin jsonb := '{"team_name":"West Ham United","score":41,"won":10,"drawn":11,"lost":17,"goals_for":40,"goals_against":60,"league_position":17,"trophy":true,"detail":"SURVIVED","payload":"eyJ2IjoxLCJraW5kIjoicnVuaW4iLCJkYXRhIjoiMjAyNi0xMC0yNCJ9xxxxxx","xi":["a","b","c","d","e","f","g","h","i","j","k"],"history_key":"k3","draft_fingerprint":"f3","claim_matched":false,"engine_version":"6","data_version":"data-1"}';
begin
  perform test.act('service_role', null);
  select * into k from casual_keys;
  r := public.svc_casual_submit('22222222-2222-4222-8222-222222222222', 'arena', k.today, arena);
  assert r->>'status' = 'ranked' and (r->>'position')::int = 1 and (r->>'total')::int = 1 and r->>'country' = 'GB' and (r->>'countryPosition')::int = 1, r::text;
  assert r->'entry'->>'score' = '9' and r->'entry'->>'detail' = '9 rungs' and not (r->'entry'->>'trophy')::boolean, r::text;
  r := public.svc_casual_submit('22222222-2222-4222-8222-222222222222', 'arena', k.today, arena);
  assert r->>'status' = 'duplicate', 'a retry ' || r;
  r := public.svc_casual_submit('22222222-2222-4222-8222-222222222222', 'arena', k.today, arena || '{"draft_fingerprint":"f9","score":15,"won":15,"lost":0}');
  assert r->>'status' = 'already_submitted' and r->'entry'->>'score' = '9', 'the first post stands ' || r;
  -- Erin climbs as far with a better goal difference; Finn (no profile yet) as far, same difference, conceding fewer
  r := public.svc_casual_submit('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'arena', k.today, arena || '{"draft_fingerprint":"f4","goals_for":25}');
  assert r->>'status' = 'ranked' and (r->>'position')::int = 1 and (r->>'total')::int = 2 and (r->>'countryPosition')::int = 1 and (r->>'countryTotal')::int = 1, 'goal difference second ' || r;
  r := public.svc_casual_submit('c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', 'arena', k.today, arena || '{"draft_fingerprint":"f5","goals_for":17,"goals_against":5}');
  assert r->>'status' = 'ranked' and (r->>'position')::int = 2 and r->>'country' is null, 'fewer conceded third ' || r;
  -- An arena step count is 1 to 20, the score is the steps won, and no league place or draw
  assert test.try(format($q$select public.svc_casual_submit('22222222-2222-4222-8222-222222222222', 'arena', %L, %L)$q$, k.yesterday, arena || '{"score":8}')) like '23514%', 'arena score = steps won';
  assert test.try(format($q$select public.svc_casual_submit('22222222-2222-4222-8222-222222222222', 'arena', %L, %L)$q$, k.yesterday, arena || '{"league_position":3}')) like '23514%', 'no league place in the arena';
  assert test.try(format($q$select public.svc_casual_submit('22222222-2222-4222-8222-222222222222', 'arena', %L, %L)$q$, k.yesterday, arena || '{"lost":2}')) like '23514%', 'a run ends at its first defeat';
  assert test.try(format($q$select public.svc_casual_submit('22222222-2222-4222-8222-222222222222', 'arena', %L, %L)$q$, k.yesterday, arena || '{"team_name":"Touch​line"}')) like '23514%', 'team names are clean';
  assert test.try(format($q$select public.svc_casual_submit('22222222-2222-4222-8222-222222222222', 'arena', %L, %L)$q$, k.yesterday, arena || '{"detail":""}')) like '23514%', 'a detail is 1 to 40 characters';
  -- Yesterday's Daily Arena still takes posts; the day before has closed
  r := public.svc_casual_submit('22222222-2222-4222-8222-222222222222', 'arena', k.yesterday, arena);
  assert r->>'status' = 'ranked', 'yesterday ' || r;
  r := public.svc_casual_submit('22222222-2222-4222-8222-222222222222', 'arena', k.before, arena);
  assert r->>'status' = 'closed', 'the day before ' || r;
  r := public.svc_casual_submit('22222222-2222-4222-8222-222222222222', 'themed', k.old_week, league);
  assert r->>'status' = 'closed', 'a past week ' || r;
  -- A period nobody pinned
  r := public.svc_casual_submit('22222222-2222-4222-8222-222222222222', 'runin', to_char((now() at time zone 'UTC')::date + 7, 'IYYY-"W"IW'), runin);
  assert r->>'status' = 'closed', 'next week is not open yet ' || r;
  -- The Weekly Challenge: a league season, points = 3w + d, 30 to 46 games
  r := public.svc_casual_submit('22222222-2222-4222-8222-222222222222', 'themed', k.week, league);
  assert r->>'status' = 'ranked' and (r->>'position')::int = 1, r::text;
  assert test.try(format($q$select public.svc_casual_submit('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'themed', %L, %L)$q$, k.week, league || '{"score":81}')) like '23514%', 'a league score is 3w + d';
  assert test.try(format($q$select public.svc_casual_submit('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'themed', %L, %L)$q$, k.week, league || '{"won":3,"drawn":0,"lost":0,"score":9}')) like '23514%', 'a league season has 30 to 46 games';
  r := public.svc_casual_submit('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'themed', k.week, league || '{"draft_fingerprint":"f6","score":81,"lost":5,"drawn":9}');
  assert r->>'status' = 'ranked' and (r->>'position')::int = 1, 'more points lead ' || r;
  r := public.svc_casual_submit('c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', 'themed', k.week, league || '{"draft_fingerprint":"f7","score":80,"won":25,"drawn":5,"lost":8}');
  assert r->>'status' = 'ranked' and (r->>'position')::int = 3, 'level on points, more defeats last ' || r;
  assert test.try(format($q$select public.svc_casual_submit('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'runin', %L, %L)$q$, k.week, runin || '{"league_position":null}')) like '23514%', 'a run-in has a league place';
  -- The Run-in of the week: the final table's points, a brief met or missed
  r := public.svc_casual_submit('22222222-2222-4222-8222-222222222222', 'runin', k.week, runin);
  assert r->>'status' = 'ranked' and (r->'entry'->>'trophy')::boolean and r->'entry'->>'detail' = 'SURVIVED' and not (r->'entry'->>'claimMatched')::boolean, r::text;
end $t$;

\echo '--- casual: the public boards, the summaries, the reveal, and each account''s own entries'
do $t$ declare k casual_keys; begin
  perform test.act('anon', null);
  select * into k from casual_keys;
  assert (select string_agg(display_name || ':' || score || ':' || goal_diff, ',' order by board_position) from public.casual_board('arena', k.today))
       like 'Erin:9:17,Manager%:9:12,Bob the Builder:9:12', 'arena order ' || (select string_agg(display_name || ':' || score || ':' || goal_diff, ',' order by board_position) from public.casual_board('arena', k.today));
  assert (select string_agg(left(display_name, 4), ',' order by board_position) from public.casual_board('themed', k.week)) = 'Erin,Bob ,Mana', 'league order';
  assert (select bool_and(payload is null and xi is null and not revealed and not is_me) from public.casual_board('arena', k.today)), 'picks hidden while posts are open';
  assert (select display_name from public.casual_board('arena', k.today, 50, 0, 'GB')) = 'Bob the Builder', 'GB board';
  assert (select count(*) from public.casual_board('arena', k.today, 50, 0, 'FR')) = 0, 'an empty country';
  assert (select board_position from public.casual_board('arena', k.today, 1, 1)) = 2, 'paging';
  assert (select played = 3 and top_score = 9 and trophies = 0 and posts_open and not revealed and my_position is null from public.casual_summary('arena', k.today)), 'arena summary';
  assert (select played = 1 and trophies = 1 from public.casual_summary('runin', k.week)), 'run-in summary';
  assert (select played = 1 from public.casual_summary('themed', k.week, 'VN')), 'VN summary';
end $t$;
do $t$ declare k casual_keys; begin
  perform test.act('authenticated', '22222222-2222-4222-8222-222222222222');
  select * into k from casual_keys;
  assert (select my_position = 3 and my_score = 9 from public.casual_summary('arena', k.today)), 'Bob third on the arena';
  assert (select my_position from public.casual_summary('arena', k.today, 'GB')) = 1, 'Bob first in GB';
  assert (select count(*) from public.casual_board('arena', k.today) where is_me) = 1, 'Bob sees his row';
  assert (select count(*) from public.casual_my_entries()) = 4, 'Bob lists his four entries ' || (select count(*) from public.casual_my_entries());
  assert (select count(*) from public.casual_my_entries('arena')) = 2, 'two of them arena runs';
  assert (select period_key from public.casual_my_entries('runin')) = k.week, 'the run-in under its week';
  assert test.try($$select * from private.casual_entries$$) like '42501%', 'signed in still cannot read the table';
end $t$;
-- Posting has closed on the day before yesterday: that board shows its picks
insert into private.casual_entries (board, period_start, user_id, display_name, country, team_name, score, won, drawn, lost, goals_for, goals_against, trophy, detail, payload, xi, history_key, draft_fingerprint, claim_matched, engine_version, data_version)
values ('arena', (now() at time zone 'UTC')::date - 2, '22222222-2222-4222-8222-222222222222', 'Bob the Builder', 'GB', 'Touchline XI', 15, 15, 0, 0, 30, 10, true, 'Gauntlet complete',
  'eyJ2IjoyLCJraW5kIjoiYXJlbmEiLCJkYXRhIjoiMjAyNi0xMC0yNCJ9xxxxxx', array['a','b','c','d','e','f','g','h','i','j','k'], 'k9', 'f9', true, '6', 'data-1');
do $t$ declare d text := (select before from casual_keys); begin
  perform test.act('anon', null);
  assert (select bool_and(revealed and payload is not null and cardinality(xi) = 11 and trophy) from public.casual_board('arena', d)), 'picks revealed once closed';
  assert (select not posts_open and revealed and trophies = 1 from public.casual_summary('arena', d)), 'the summary says so';
end $t$;

\echo '--- casual: hiding an entry takes it off the board; deleting an account removes its entries'
update private.casual_entries set hidden = true where user_id = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1' and board = 'themed';
do $t$ begin
  perform test.act('anon', null);
  assert (select left(display_name, 3) from public.casual_board('themed', (select week from casual_keys)) where board_position = 1) = 'Bob', 'a hidden run leaves the board';
end $t$;
delete from auth.users where id in ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2');
do $t$ begin
  assert not exists (select 1 from private.casual_entries where user_id in ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2')), 'deletion cascades';
end $t$;
\echo 'CASUAL ASSERTIONS PASSED'

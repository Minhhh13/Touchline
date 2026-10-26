-- The 38-0 chase (migration chase_board): server-issued attempts with a daily cap, one post per attempt within its
-- 48 hours, best run per account on the weekly and all-time boards ordered by points dropped, flawless seasons,
-- the closest-ever record, country filters, and nobody but service_role writing anything. Runs after phase1.sql
-- (which deletes Alice): uses Bob (GB), Carol (no profile yet) and a fresh Dana.
\set ON_ERROR_STOP on
\pset pager off

insert into auth.users (id, email, is_anonymous) values ('55555555-5555-4555-8555-555555555555', 'dana@example.com', false);
insert into public.profiles (user_id, display_name, country) values ('55555555-5555-4555-8555-555555555555', 'Dana', 'VN');

create temp table chase_codes (who text, code text);
grant select, insert on chase_codes to anon, authenticated, service_role;

\echo '--- chase: the client roles cannot start, read or post attempts, or touch the tables'
do $t$ begin
  perform test.act('authenticated', '22222222-2222-4222-8222-222222222222');
  assert test.try($$select public.svc_chase_start('22222222-2222-4222-8222-222222222222', 'england', '4-3-3', '4', '2026-10-25')$$) like '42501%', 'client starts an attempt';
  assert test.try($$select public.svc_chase_start('22222222-2222-4222-8222-222222222222', 'england', '4-3-3', '4', '2026-10-25', 'prime', 1)$$) like '42501%', 'client starts an attempt with options';
  assert test.try($$select public.svc_chase_attempt('22222222-2222-4222-8222-222222222222', 'AAAAAAAAAA')$$) like '42501%', 'client reads an attempt';
  assert test.try($$select public.svc_chase_submit('22222222-2222-4222-8222-222222222222', 'AAAAAAAAAA', '{}')$$) like '42501%', 'client posts a run';
  assert test.try($$select * from private.chase_attempts$$) like '42501%', 'client reads attempts';
  assert test.try($$select * from private.chase_entries$$) like '42501%', 'client reads entries';
  assert test.try($$insert into private.chase_attempts (user_id, code, league_id, formation_id, engine_version, data_version, expires_at) values ('22222222-2222-4222-8222-222222222222', 'AAAAAAAAAA', 'england', '4-3-3', '4', 'd', now() + interval '1 hour')$$) like '42501%', 'client inserts an attempt';
  assert test.try($$select private.chase_position(1, null, null)$$) like '42501%', 'client calls a private helper';
end $t$;
do $t$ begin
  perform test.act('anon', null);
  assert test.try($$select public.svc_chase_start('22222222-2222-4222-8222-222222222222', 'england', '4-3-3', '4', '2026-10-25')$$) like '42501%', 'anon starts an attempt';
  assert test.try($$select * from public.chase_my_status()$$) like '42501%', 'anon has no chase status';
  assert test.try($$select * from public.chase_my_entries()$$) like '42501%', 'anon has no chase entries';
  assert (select count(*) from public.chase_board()) = 0, 'an empty board reads empty';
  assert (select players = 0 and runs = 0 and record_points is null from public.chase_summary()), 'an empty summary';
  assert test.try($$select * from public.chase_board('forever')$$) like '22023%', 'scope is week or alltime';
end $t$;

\echo '--- chase: svc_chase_start issues random codes, at most five a UTC day per account'
do $t$ declare r jsonb; begin
  perform test.act('service_role', null);
  for i in 1 .. 5 loop
    r := public.svc_chase_start('22222222-2222-4222-8222-222222222222', 'england', '4-3-3', '4', '2026-10-25');
    assert r->>'status' = 'ok' and (r->>'left')::int = 5 - i, 'attempt ' || i || ' ' || r;
    assert r->'attempt'->>'code' ~ '^[A-HJ-NP-Z2-9]{10}$' and r->'attempt'->>'seed' = 'chase-' || (r->'attempt'->>'code'), r::text;
    assert (r->'attempt'->>'expiresAt')::timestamptz - (r->'attempt'->>'createdAt')::timestamptz = interval '48 hours', 'open for 48 hours';
    insert into chase_codes values ('bob' || i, r->'attempt'->>'code');
  end loop;
  r := public.svc_chase_start('22222222-2222-4222-8222-222222222222', 'england', '4-3-3', '4', '2026-10-25');
  assert r->>'status' = 'limit' and (r->>'left')::int = 0 and (r->>'cap')::int = 5, 'the sixth attempt of the day is refused ' || r;
  assert (select count(distinct code) from chase_codes) = 5, 'five different codes';
  assert (select count(*) from private.chase_attempts where user_id = '22222222-2222-4222-8222-222222222222') = 5, 'the refused start wrote nothing';
  -- yesterday's attempts do not count against today
  update private.chase_attempts set created_at = created_at - interval '1 day', expires_at = expires_at - interval '1 day' where code = (select code from chase_codes where who = 'bob5');
  r := public.svc_chase_start('22222222-2222-4222-8222-222222222222', 'germany', '4-4-2', '4', '2026-10-25', 'prime', 1);
  assert r->>'status' = 'ok' and (r->>'left')::int = 0 and r->'attempt'->>'leagueId' = 'germany', 'an attempt from yesterday frees a place ' || r;
  assert r->'attempt'->>'ratings' = 'prime' and (r->'attempt'->>'benchPicks')::int = 1, 'the ratings and bench chosen at issue are kept ' || r;
  assert (select ratings = 'season' and bench_picks = 0 from private.chase_attempts where code = (select code from chase_codes where who = 'bob1')), 'season ratings and no bench by default';
  insert into chase_codes values ('bob6', r->'attempt'->>'code');
  assert test.try($$select public.svc_chase_start('33333333-3333-4333-8333-333333333333', 'England!', '4-3-3', '4', 'd')$$) like '23514%', 'league id shape';
  assert test.try($$select public.svc_chase_start('33333333-3333-4333-8333-333333333333', 'england', '4 3 3', '4', 'd')$$) like '23514%', 'formation id shape';
  assert test.try($$select public.svc_chase_start('33333333-3333-4333-8333-333333333333', 'england', '4-3-3', '4', 'd', 'blind', 0)$$) like '23514%', 'ratings are season or prime';
  assert test.try($$select public.svc_chase_start('33333333-3333-4333-8333-333333333333', 'england', '4-3-3', '4', 'd', 'prime', 6)$$) like '23514%', 'a bench is 0 to 5';
  r := public.svc_chase_start('33333333-3333-4333-8333-333333333333', 'england', '4-3-3', '4', '2026-10-25');
  insert into chase_codes values ('carol1', r->'attempt'->>'code');
  r := public.svc_chase_start('55555555-5555-4555-8555-555555555555', 'england', '4-2-3-1', '4', '2026-10-25');
  insert into chase_codes values ('dana1', r->'attempt'->>'code');
  r := public.svc_chase_start('55555555-5555-4555-8555-555555555555', 'england', '4-2-3-1', '4', '2026-10-25');
  insert into chase_codes values ('dana2', r->'attempt'->>'code');
  -- svc_chase_attempt answers only the owner
  assert public.svc_chase_attempt('22222222-2222-4222-8222-222222222222', (select code from chase_codes where who = 'bob1'))->>'leagueId' = 'england', 'owner reads the attempt';
  assert public.svc_chase_attempt('33333333-3333-4333-8333-333333333333', (select code from chase_codes where who = 'bob1')) is null, 'another account does not';
end $t$;

\echo '--- chase: one post per attempt, only its owner, only while open; figures checked; best run per account'
do $t$
declare
  r jsonb;
  e jsonb := '{"team_name":"Touchline XI","points":100,"won":32,"drawn":4,"lost":2,"goals_for":90,"goals_against":30,"league_position":1,"tier":"CHAMPIONS","payload":"eyJ2IjoxLCJkYXRhIjoiMjAyNi0xMC0yNCIsImVuZ2luZSI6IjMifQxxxxxx","xi":["a","b","c","d","e","f","g","h","i","j","k"],"history_key":"k1","draft_fingerprint":"c1","claim_matched":true,"engine_version":"4","data_version":"2026-10-25"}';
  bob1 text := (select code from chase_codes where who = 'bob1');
  bob2 text := (select code from chase_codes where who = 'bob2');
  bob3 text := (select code from chase_codes where who = 'bob3');
  bob5 text := (select code from chase_codes where who = 'bob5');
begin
  perform test.act('service_role', null);
  r := public.svc_chase_submit('33333333-3333-4333-8333-333333333333', bob1, e);
  assert r->>'status' = 'no_attempt', 'another account cannot post Bob''s wheel ' || r;
  r := public.svc_chase_submit('22222222-2222-4222-8222-222222222222', 'ZZZZZZZZZZ', e);
  assert r->>'status' = 'no_attempt', 'unknown code ' || r;
  r := public.svc_chase_submit('22222222-2222-4222-8222-222222222222', bob1, e);
  assert r->>'status' = 'ranked' and (r->>'position')::int = 1 and (r->>'total')::int = 1 and (r->>'weekPosition')::int = 1 and r->>'country' = 'GB'
     and (r->>'personalBest')::boolean and not (r->>'perfect')::boolean and (r->>'games')::int = 38, r::text;
  assert (select submitted_at is not null from private.chase_attempts where code = bob1), 'the attempt is closed';
  r := public.svc_chase_submit('22222222-2222-4222-8222-222222222222', bob1, e);
  assert r->>'status' = 'duplicate', 'a retry ' || r;
  r := public.svc_chase_submit('22222222-2222-4222-8222-222222222222', bob1, e || '{"draft_fingerprint":"c9","points":114,"won":38,"drawn":0,"lost":0}');
  assert r->>'status' = 'already_submitted' and r->'entry'->>'points' = '100', 'the first post of an attempt stands ' || r;
  assert test.try(format($q$select public.svc_chase_submit('22222222-2222-4222-8222-222222222222', %L, %L)$q$, bob2, e || '{"points":101}')) like '23514%', 'points must equal 3w + d';
  assert test.try(format($q$select public.svc_chase_submit('22222222-2222-4222-8222-222222222222', %L, %L)$q$, bob2, e || '{"won":3,"drawn":0,"lost":0,"points":9}')) like '23514%', 'a season has at least ten games';
  assert test.try(format($q$select public.svc_chase_submit('22222222-2222-4222-8222-222222222222', %L, %L)$q$, bob2, e || '{"team_name":"Touch​line"}')) like '23514%', 'team names are clean';
  -- a worse second run: Bob stays on the board once, with his best
  r := public.svc_chase_submit('22222222-2222-4222-8222-222222222222', bob2, e || '{"draft_fingerprint":"c2","points":80,"won":24,"drawn":8,"lost":6}');
  assert r->>'status' = 'ranked' and not (r->>'personalBest')::boolean and (r->>'position')::int = 1 and (r->>'total')::int = 1, 'a worse run keeps the best ' || r;
  -- an expired attempt cannot post
  update private.chase_attempts set created_at = now() - interval '3 days', expires_at = now() - interval '1 day' where code = bob3;
  r := public.svc_chase_submit('22222222-2222-4222-8222-222222222222', bob3, e || '{"draft_fingerprint":"c3"}');
  assert r->>'status' = 'closed', 'an expired attempt ' || r;
  -- Carol (no profile yet) posts a flawless 38-0 and gets a default name
  r := public.svc_chase_submit('33333333-3333-4333-8333-333333333333', (select code from chase_codes where who = 'carol1'), e || '{"draft_fingerprint":"c4","points":114,"won":38,"drawn":0,"lost":0,"goals_for":110,"goals_against":12}');
  assert r->>'status' = 'ranked' and (r->>'perfect')::boolean and (r->>'position')::int = 1 and (r->>'total')::int = 2 and r->>'country' is null, 'a flawless season leads ' || r;
  -- Dana (VN) posts a Bundesliga-length 33-1-0 (34 games, 100 points, 2 dropped): ahead of Bob's 100 from 38 (14 dropped)
  r := public.svc_chase_submit('55555555-5555-4555-8555-555555555555', (select code from chase_codes where who = 'dana1'), e || '{"draft_fingerprint":"c5","points":100,"won":33,"drawn":1,"lost":0,"goals_for":95,"goals_against":20}');
  assert r->>'status' = 'ranked' and (r->>'position')::int = 2 and (r->>'games')::int = 34 and (r->>'countryPosition')::int = 1 and (r->>'countryTotal')::int = 1, 'points dropped decide across lengths ' || r;
  -- Bob's attempt from yesterday files under the week it was issued in
  r := public.svc_chase_submit('22222222-2222-4222-8222-222222222222', bob5, e || '{"draft_fingerprint":"c6","points":60,"won":16,"drawn":12,"lost":10}');
  assert r->>'status' = 'ranked' and r->>'week' = to_char(private.week_start_of(((now() - interval '1 day') at time zone 'UTC')::date), 'IYYY-"W"IW'), 'issued week ' || r;
end $t$;

\echo '--- chase: the public boards (best per account, points dropped first), the summary and the closest-ever record'
do $t$ begin
  perform test.act('anon', null);
  assert (select string_agg(left(display_name, 7) || ':' || points || ':' || dropped, ',' order by board_position) from public.chase_board('alltime'))
       = 'Manager:114:0,Dana:100:2,Bob the:100:14', 'all-time order ' || (select string_agg(display_name || ':' || points, ',' order by board_position) from public.chase_board('alltime'));
  assert (select count(*) from public.chase_board('alltime') where display_name = 'Bob the Builder') = 1, 'one row per account';
  assert (select perfect and games = 38 and won = 38 and ratings = 'season' and bench_picks = 0 from public.chase_board('alltime') where board_position = 1), 'the flawless season is flagged, with its ratings and bench';
  assert (select bool_and(payload is not null and not is_me) from public.chase_board('alltime')), 'payloads are public (personal, single-use seeds); nobody is "me" signed out';
  assert (select display_name from public.chase_board('alltime', null, 50, 0, 'GB')) = 'Bob the Builder', 'GB board';
  assert (select count(*) from public.chase_board('alltime', null, 50, 0, 'FR')) = 0, 'an empty country';
  assert (select count(*) from public.chase_board('alltime', null, 1, 1)) = 1 and (select board_position from public.chase_board('alltime', null, 1, 1)) = 2, 'paging';
  assert (select players = 3 and runs = 5 and flawless = 1 and my_position is null and record_points = 114 and record_won = 38 and record_flawless = 1 from public.chase_summary('alltime')), 'all-time summary';
  assert (select players = 1 and runs = 1 and record_points = 100 and record_won = 33 and record_games = 34 from public.chase_summary('week', null, 'VN')), 'VN summary and record';
end $t$;
do $t$ begin
  perform test.act('authenticated', '22222222-2222-4222-8222-222222222222');
  assert (select my_position = 3 and my_points = 100 and my_won = 32 from public.chase_summary('alltime')), 'Bob third all time, with his best';
  assert (select my_position from public.chase_summary('alltime', null, 'GB')) = 1, 'Bob first in GB';
  assert (select count(*) from public.chase_board('alltime') where is_me) = 1, 'Bob sees his own row flagged';
  -- today: bob1, bob2, bob4 and bob6 (bob3 and bob5 were moved to earlier days); posted: bob1, bob2, bob5
  assert (select attempts_today = 4 and cap = 5 and attempts_left = 1 and runs = 3 and best_points = 100 from public.chase_my_status()), 'Bob''s status ' || (select row(s.*)::text from public.chase_my_status() s);
  assert (select count(*) from public.chase_my_entries()) = 3, 'Bob lists his three posted runs';
  assert test.try($$select * from private.chase_entries$$) like '42501%', 'signed in still cannot read the table';
end $t$;
do $t$ begin
  perform test.act('authenticated', '33333333-3333-4333-8333-333333333333');
  assert (select attempts_today = 1 and attempts_left = 4 and best_won = 38 from public.chase_my_status()), 'Carol''s status';
  assert (select count(*) from public.chase_my_entries()) = 1, 'Carol lists only her own run';
end $t$;

\echo '--- chase: hiding an entry takes it off every board; deleting an account removes its attempts and runs'
update private.chase_entries set hidden = true where user_id = '33333333-3333-4333-8333-333333333333';
do $t$ begin
  perform test.act('anon', null);
  assert (select display_name from public.chase_board('alltime') where board_position = 1) = 'Dana', 'a hidden run leaves the board';
  assert (select flawless = 0 and record_won = 33 from public.chase_summary('alltime')), 'and the record';
end $t$;
delete from auth.users where id = '55555555-5555-4555-8555-555555555555';
do $t$ begin
  assert not exists (select 1 from private.chase_attempts where user_id = '55555555-5555-4555-8555-555555555555')
     and not exists (select 1 from private.chase_entries where user_id = '55555555-5555-4555-8555-555555555555'), 'deletion cascades';
end $t$;
\echo 'CHASE ASSERTIONS PASSED'

-- Adversarial review of Phase 1 (2026-10-25): the attacks a hostile or buggy client tries through the Data API.
-- Runs after phase1.sql on its own accounts, so it does not depend on what that suite left behind.
\set ON_ERROR_STOP on
\pset pager off

insert into auth.users (id, email) values
  ('55555555-5555-4555-8555-555555555555', 'dave@example.com'),
  ('66666666-6666-4666-8666-666666666666', 'erin@example.com');

\echo '--- review: the suite runs on a UTF-8 database, as Supabase does (the name checks are meaningless otherwise)'
do $t$ begin
  assert pg_encoding_to_char((select encoding from pg_database where datname = current_database())) = 'UTF8', 'run the SQL suites on a UTF8 database';
end $t$;

\echo '--- review: compare-and-set refuses a null base revision (it used to skip the check and overwrite)'
do $t$ declare r jsonb; h1 text := repeat('1', 64); h2 text := repeat('2', 64); begin
  perform test.act('authenticated', '55555555-5555-4555-8555-555555555555');
  insert into storage.objects (bucket_id, name) values
    ('saves', '55555555-5555-4555-8555-555555555555/quick/1-1111111111111111.json.gz'),
    ('saves', '55555555-5555-4555-8555-555555555555/quick/2-2222222222222222.json.gz'),
    ('saves', '55555555-5555-4555-8555-555555555555/quick/3-3333333333333333.json.gz');
  r := public.save_claim('quick', 0, 'g1', h1, '55555555-5555-4555-8555-555555555555/quick/1-1111111111111111.json.gz', 10, 10, '{}', 'device-dddd', now());
  assert r ->> 'status' = 'ok', r::text;
  r := public.save_claim('quick', null, 'g2', h2, '55555555-5555-4555-8555-555555555555/quick/2-2222222222222222.json.gz', 10, 10, '{}', 'device-dddd', now());
  assert r ->> 'status' = 'conflict', 'save_claim with a null base revision must conflict, got ' || r::text;
  assert (select revision from public.cloud_saves where slot = 'quick') = 1, 'the row moved on a null base';
  r := public.save_delete('quick', null, 'device-dddd');
  assert r ->> 'status' = 'conflict', 'save_delete with a null base revision must conflict, got ' || r::text;
  assert (select deleted_at from public.cloud_saves where slot = 'quick') is null, 'tombstoned on a null base';
  r := public.profile_put(0, '{"v":1}', 'device-dddd');
  assert r ->> 'status' = 'ok', r::text;
  r := public.profile_put(null, '{"v":2}', 'device-dddd');
  assert r ->> 'status' = 'conflict', 'profile_put with a null base revision must conflict, got ' || r::text;
  assert (select data from public.cloud_profile) = '{"v":1}'::jsonb, 'profile overwritten on a null base';
  assert test.try($$select public.save_delete('nope', 1, 'device-dddd')$$) like '22023%', 'save_delete checks the slot name';
end $t$;

\echo '--- review: a claim never tells the client to delete an object a row still points at'
do $t$ declare r jsonb; h1 text := repeat('1', 64); h2 text := repeat('2', 64); begin
  perform test.act('authenticated', '55555555-5555-4555-8555-555555555555');
  -- current = 2 (g2/h2), previous = 1 (g1/h1)
  r := public.save_claim('quick', 1, 'g2', h2, '55555555-5555-4555-8555-555555555555/quick/2-2222222222222222.json.gz', 10, 10, '{}', 'device-dddd', now());
  assert r ->> 'status' = 'ok', r::text;
  -- re-claim the current content under the previous copy's object: nothing referenced may be called obsolete
  r := public.save_claim('quick', 2, 'g2', h2, '55555555-5555-4555-8555-555555555555/quick/1-1111111111111111.json.gz', 10, 10, '{}', 'device-dddd', now());
  assert r ->> 'status' = 'unchanged', r::text;
  assert not (r -> 'obsolete') ? '55555555-5555-4555-8555-555555555555/quick/1-1111111111111111.json.gz', 'told to delete the previous copy: ' || r::text;
  -- file the current object as the previous copy: the current object must not be called obsolete
  assert test.try($$select public.save_claim('quick', 2, 'g2', repeat('2', 64), '55555555-5555-4555-8555-555555555555/quick/2-2222222222222222.json.gz', 10, 10, '{}', 'device-dddd', now(), true)$$) like '22023%', 'filed the current object as its own previous copy';
  -- a normal claim of the object that is already the previous copy must not report it obsolete either
  r := public.save_claim('quick', 2, 'g3', repeat('3', 64), '55555555-5555-4555-8555-555555555555/quick/1-1111111111111111.json.gz', 10, 10, '{}', 'device-dddd', now());
  assert r ->> 'status' = 'ok', r::text;
  assert not exists (
    select 1 from jsonb_array_elements_text(r -> 'obsolete') o, public.cloud_saves s
    where s.slot = 'quick' and (o = s.object_path or o = s.prev_object_path)), 'an obsolete path is still referenced: ' || r::text;
end $t$;

\echo '--- review: the object-count helper cannot count another account''s objects'
do $t$ begin
  perform test.act('authenticated', '66666666-6666-4666-8666-666666666666');
  assert test.try($$select private.save_object_count('55555555-5555-4555-8555-555555555555'::uuid)$$) not like 'ok', 'save_object_count takes a user id from the caller';
  assert private.save_object_count() = 0, 'own count';
end $t$;

\echo '--- review: a client cannot write the boards, the totals or the puzzles, directly or through a helper'
do $t$ begin
  perform test.act('authenticated', '66666666-6666-4666-8666-666666666666');
  assert test.try($$insert into public.daily_puzzles (puzzle_date, seed, settings, settings_hash, engine_version, data_version) values ('2030-01-01', 'daily-2030-01-01', '{}', 'h', '4', 'd')$$) like '42501%', 'client pins a daily';
  assert test.try($$insert into public.weekly_puzzles (week_start, week_key, seed, settings, settings_hash, engine_version, data_version) values ('2030-01-07', '2030-W02', 'weekly-2030-W02', '{}', 'h', '4', 'd')$$) like '42501%', 'client pins a week';
  assert test.try($$update public.daily_puzzles set settings = '{}'$$) like '42501%', 'client edits a pin';
  assert test.try($$select private.daily_totals_refresh('66666666-6666-4666-8666-666666666666')$$) like '42501%', 'client refreshes totals';
  assert test.try($$select private.ensure_display_name('66666666-6666-4666-8666-666666666666')$$) like '42501%', 'client allocates a name';
  assert test.try($$select private.take_rate_limit('x', '66666666-6666-4666-8666-666666666666', 1, 1)$$) like '42501%', 'client resets a rate limit';
  assert test.try($$select private.daily_position(1)$$) like '42501%', 'client reads positions by entry id';
  assert test.try($$select private.random_code(8)$$) like '42501%', 'client draws codes';
  assert test.try($$insert into public.challenges (code, owner_id, payload) values ('ABCDEFGH', '66666666-6666-4666-8666-666666666666', '{}')$$) like '42501%', 'client inserts a challenge row';
  assert test.try($$update public.challenges set expires_at = now() + interval '100 years'$$) like '42501%', 'client extends a challenge';
  assert test.try($$update public.cloud_saves set revision = 1$$) like '42501%', 'client writes cloud_saves directly';
  assert test.try($$insert into public.cloud_profile (user_id, revision, data, device_id) values ('66666666-6666-4666-8666-666666666666', 1, '{}', 'device-eeee')$$) like '42501%', 'client writes cloud_profile directly';
  assert test.try($$update public.profiles set created_at = now() - interval '9 years'$$) like '42501%', 'client rewrites created_at';
end $t$;

\echo '--- review: another account''s saves and objects stay invisible and undeletable'
do $t$ begin
  perform test.act('authenticated', '66666666-6666-4666-8666-666666666666');
  assert (select count(*) from public.cloud_saves) = 0, 'reads another account''s save rows';
  assert (select count(*) from public.cloud_profile) = 0, 'reads another account''s profile document';
  assert (select count(*) from storage.objects where bucket_id = 'saves') = 0, 'lists another account''s objects';
  delete from storage.objects where bucket_id = 'saves';
  assert (select count(*) from public.save_orphans()) = 0, 'sees another account''s orphans';
  assert (public.cloud_delete_all() -> 'objects') = '[]'::jsonb, 'delete-all reaches another account';
end $t$;
do $t$ begin
  assert (select count(*) from storage.objects where name like '55555555-%') = 3, 'another account deleted the objects';
  assert (select count(*) from public.cloud_saves where user_id = '55555555-5555-4555-8555-555555555555') = 1, 'another account dropped the row';
end $t$;

\echo '--- review: names and team names cannot hide invisible or direction-changing characters'
do $t$ begin
  perform test.act('authenticated', '66666666-6666-4666-8666-666666666666');
  assert test.try($$insert into public.profiles (user_id, display_name) values ('66666666-6666-4666-8666-666666666666', E'Minh\u200bH')$$) like '23514%', 'zero-width space in a name';
  assert test.try($$insert into public.profiles (user_id, display_name) values ('66666666-6666-4666-8666-666666666666', E'Erin \u202enul')$$) like '23514%', 'right-to-left override in a name';
  assert test.try($$insert into public.profiles (user_id, display_name) values ('66666666-6666-4666-8666-666666666666', E'Erin\u00a0\u00a0W')$$) like '23514%', 'doubled no-break spaces';
  assert test.try($$insert into public.profiles (user_id, display_name) values ('66666666-6666-4666-8666-666666666666', E'Erin\ufeff')$$) like '23514%', 'byte-order mark in a name';
  insert into public.profiles (user_id, display_name) values ('66666666-6666-4666-8666-666666666666', 'Érin Ñ');
end $t$;
do $t$ declare r jsonb; begin
  perform public.svc_daily_pin((now() at time zone 'UTC')::date, '{"mode":"daily"}', 'h', '4', 'd');
  perform public.svc_weekly_pin(private.week_start_of((now() at time zone 'UTC')::date), '{"mode":"quick"}', 'h', '4', 'd');
  r := '{"team_name":"x","points":70,"won":20,"drawn":10,"lost":8,"goals_for":60,"goals_against":40,"league_position":4,"tier":"EUROPEAN","payload":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","xi":["1","2","3","4","5","6","7","8","9","10","11"],"history_key":"k","draft_fingerprint":"f","claim_matched":true,"engine_version":"4","data_version":"d"}';
  assert test.try(format('select public.svc_daily_submit(%L, %L, %L)', '66666666-6666-4666-8666-666666666666', (now() at time zone 'UTC')::date, jsonb_set(r, '{team_name}', to_jsonb(E'Real\u202eFC'::text)))) like '23514%', 'right-to-left override in a team name';
  assert test.try(format('select public.svc_weekly_submit(%L, %L, %L)', '66666666-6666-4666-8666-666666666666', private.week_start_of((now() at time zone 'UTC')::date), jsonb_set(r, '{team_name}', to_jsonb(E'Real\u200bFC'::text)))) like '23514%', 'zero-width space in a weekly team name';
end $t$;

\echo '--- review: a forged entry the database itself refuses (impossible figures)'
do $t$ declare r jsonb; begin
  r := '{"team_name":"x","points":120,"won":38,"drawn":0,"lost":0,"goals_for":60,"goals_against":40,"league_position":1,"tier":"PERFECT","payload":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","xi":["1","2","3","4","5","6","7","8","9","10","11"],"history_key":"k","draft_fingerprint":"f","claim_matched":true,"engine_version":"4","data_version":"d"}';
  assert test.try(format('select public.svc_daily_submit(%L, %L, %L)', '66666666-6666-4666-8666-666666666666', (now() at time zone 'UTC')::date, r)) like '23514%', '120 points from 38 wins';
  r := jsonb_set(jsonb_set(r, '{points}', '114'), '{goals_for}', '-3');
  assert test.try(format('select public.svc_daily_submit(%L, %L, %L)', '66666666-6666-4666-8666-666666666666', (now() at time zone 'UTC')::date, r)) like '23514%', 'negative goals';
end $t$;

delete from auth.users where id in ('55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666');
\echo 'REVIEW ASSERTIONS PASSED'

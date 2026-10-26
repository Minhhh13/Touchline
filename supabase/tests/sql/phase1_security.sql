-- Privilege allowlist for the online layer (security review, 2026-10-25). Every function the client roles can
-- execute in public and private is listed here by name; a migration that exposes anything else, adds a SECURITY
-- DEFINER function to public, leaves a table without RLS or lets anon write fails this suite. Update the lists
-- only on purpose, in the same change that adds the function, and say why in its migration.
\set ON_ERROR_STOP on
\pset pager off

\echo '--- security: anon executes exactly the public board readers and their private helpers'
-- The 38-0 chase (migration chase_board) adds chase_board and chase_summary for everyone, chase_my_status and
-- chase_my_entries for signed-in accounts; its writers svc_chase_start, svc_chase_attempt, svc_chase_submit are
-- service_role only like every svc_*.
do $t$ declare got text[]; want text[] := array[
  'private.chase_board_impl', 'private.chase_summary_impl',
  'private.country_filter', 'private.daily_alltime_impl', 'private.daily_board_impl', 'private.daily_is_open',
  'private.daily_rank_impl', 'private.daily_revealed', 'private.daily_summary_impl', 'private.get_challenge_impl',
  'private.is_anonymous', 'private.is_clean_name', 'private.normalise_code', 'private.week_start_of',
  'private.weekly_board_impl', 'private.weekly_is_open', 'private.weekly_rank_impl', 'private.weekly_revealed',
  'private.weekly_summary_impl',
  -- Phase 2 rooms: the room reader for anyone holding a code (h2h_rooms migration)
  'private.h2h_peek_impl', 'public.h2h_peek',
  'public.chase_board', 'public.chase_summary',
  'public.daily_alltime_board', 'public.daily_board', 'public.daily_rank', 'public.daily_summary', 'public.get_challenge',
  'public.weekly_board', 'public.weekly_rank', 'public.weekly_summary'];
begin
  select array_agg(distinct (n.nspname || '.' || p.proname) collate "C" order by (n.nspname || '.' || p.proname) collate "C") into got
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute');
  assert got = (select array_agg(x order by x collate "C") from unnest(want) x), 'anon can execute: ' || got::text;
end $t$;

\echo '--- security: authenticated adds only its own saves, profile, challenge codes and entries'
do $t$ declare got text[]; want text[] := array[
  'private.chase_board_impl', 'private.chase_my_entries_impl', 'private.chase_my_status_impl', 'private.chase_summary_impl',
  'public.chase_board', 'public.chase_my_entries', 'public.chase_my_status', 'public.chase_summary',
  'private.cloud_delete_all_impl', 'private.country_filter', 'private.create_challenge_impl', 'private.daily_alltime_impl',
  'private.display_name_check_impl', 'public.display_name_check',
  'private.daily_alltime_mine_impl', 'private.daily_board_impl', 'private.daily_is_open', 'private.daily_my_entries_impl',
  'private.daily_rank_impl', 'private.daily_revealed', 'private.daily_summary_impl', 'private.get_challenge_impl',
  'private.is_anonymous', 'private.is_clean_name', 'private.normalise_code', 'private.profile_put_impl',
  'private.save_claim_impl', 'private.save_delete_impl', 'private.save_object_count', 'private.save_obsolete',
  'private.save_orphans_impl', 'private.valid_challenge_payload', 'private.week_start_of', 'private.weekly_board_impl',
  'private.weekly_is_open', 'private.weekly_my_entries_impl', 'private.weekly_rank_impl', 'private.weekly_revealed',
  'private.weekly_summary_impl',
  'private.h2h_peek_impl', 'public.h2h_peek',
  'public.cloud_delete_all', 'public.create_challenge', 'public.daily_alltime_board', 'public.daily_alltime_mine',
  'public.daily_board', 'public.daily_my_entries', 'public.daily_rank', 'public.daily_summary', 'public.get_challenge',
  'public.profile_put', 'public.save_claim', 'public.save_delete', 'public.save_orphans', 'public.weekly_board',
  'public.weekly_my_entries', 'public.weekly_rank', 'public.weekly_summary'];
begin
  select array_agg(distinct (n.nspname || '.' || p.proname) collate "C" order by (n.nspname || '.' || p.proname) collate "C") into got
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and has_function_privilege('authenticated', p.oid, 'execute');
  assert got = (select array_agg(x order by x collate "C") from unnest(want) x), 'authenticated can execute: ' || got::text;
end $t$;

\echo '--- security: every svc_* writer is service_role only, and public holds no SECURITY DEFINER function'
do $t$ declare bad text; begin
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'svc\_%'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
         or not has_function_privilege('service_role', p.oid, 'execute'));
  assert bad is null, 'svc_ functions reachable by a client role (or not by service_role): ' || bad;
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef;
  assert bad is null, 'SECURITY DEFINER in public: ' || bad;
  select string_agg(n.nspname || '.' || p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  assert bad is null, 'functions without a fixed search_path: ' || bad;
end $t$;

\echo '--- security: RLS on every table; anon writes nothing; only the puzzles are readable signed out'
do $t$ declare bad text; begin
  select string_agg(n.nspname || '.' || c.relname, ', ') into bad from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind in ('r', 'p') and not c.relrowsecurity;
  assert bad is null, 'tables without RLS: ' || bad;
  select string_agg(n.nspname || '.' || c.relname, ', ') into bad from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm')
    and has_table_privilege('anon', c.oid, 'insert,update,delete,truncate,references,trigger');
  assert bad is null, 'anon can write: ' || bad;
  select string_agg(n.nspname || '.' || c.relname, ', ' order by c.relname) into bad from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm') and has_table_privilege('anon', c.oid, 'select');
  assert bad = 'public.daily_puzzles, public.weekly_puzzles', 'anon can read: ' || coalesce(bad, '(nothing)');
  select string_agg(n.nspname || '.' || c.relname, ', ') into bad from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private' and c.relkind in ('r', 'p')
    and has_table_privilege('authenticated', c.oid, 'select,insert,update,delete');
  assert bad is null, 'authenticated can touch private tables: ' || bad;
  select string_agg(c.relname, ', ') into bad from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and has_table_privilege('authenticated', c.oid, 'insert,update,delete')
    and c.relname not in ('profiles', 'challenges');
  assert bad is null, 'authenticated can write public tables other than profiles (own row) and challenges (delete own): ' || bad;
end $t$;

\echo '--- security: no storage policy names the packs bucket (service role only)'
do $t$ begin
  assert not exists (select 1 from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects'
    and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%packs%'), 'a storage policy mentions the packs bucket';
  assert (select not public from storage.buckets where id = 'packs'), 'packs must be a private bucket';
  assert (select not public from storage.buckets where id = 'saves'), 'saves must be a private bucket';
end $t$;

\echo 'SECURITY ALLOWLIST ASSERTIONS PASSED'

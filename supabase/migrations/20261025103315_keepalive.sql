-- migration: keepalive
-- TouchLine online layer, Phase 1: the Free project's daily keep-alive, inside the project itself.
-- Supabase pauses a Free project after a week of too little user database activity and API traffic. Once a day
-- (05:23 UTC) pg_cron runs private.keepalive_ping(): one real query on public.daily_puzzles and, when the two Vault
-- secrets below exist, an HTTP GET of the project's own Data API through pg_net, so the day also carries one request
-- through the API gateway like a player's. The GitHub workflow keepalive.yml stays as a second, independent ping.
--
-- The two Vault secrets are public values (the project URL and the publishable key, both in every client build); Vault
-- only keeps them out of the repository. The owner adds them once in the SQL editor:
--   select vault.create_secret('https://yvqpmyqomkwtudxmkeou.supabase.co', 'touchline_project_url');
--   select vault.create_secret('<the sb_publishable_ key>', 'touchline_publishable_key');
-- Without them the job still runs the query every day. Without pg_cron (a plain Postgres) nothing is scheduled.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') and not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension pg_cron with schema pg_catalog;
    exception when others then
      raise notice 'pg_cron not enabled (%): enable it in the dashboard and re-run this block', sqlerrm;
    end;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') and not exists (select 1 from pg_extension where extname = 'pg_net') then
    begin
      create extension pg_net with schema extensions;
    exception when others then
      raise notice 'pg_net not enabled (%): the keep-alive runs its query only', sqlerrm;
    end;
  end if;
end
$$;

-- One query, and one request through the gateway when it is configured. Returns what it did, for the job log.
-- SECURITY DEFINER in the unexposed private schema (it reads Vault); only the cron job's owner calls it.
create or replace function private.keepalive_ping()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_puzzles bigint;
  v_url text;
  v_key text;
  v_request bigint;
begin
  select count(*) into v_puzzles from public.daily_puzzles;
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $q$
      select max(s.decrypted_secret) filter (where s.name = 'touchline_project_url'),
             max(s.decrypted_secret) filter (where s.name = 'touchline_publishable_key')
      from vault.decrypted_secrets s
      where s.name in ('touchline_project_url', 'touchline_publishable_key')
    $q$ into v_url, v_key;
  end if;
  -- only this project's own Data API, never another host
  if v_url ~ '^https://yvqpmyqomkwtudxmkeou[.]supabase[.]co/?$' and v_key is not null
     and to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') is not null then
    execute 'select net.http_get(url := $1, params := $2, headers := $3, timeout_milliseconds := $4)'
      into v_request
      using rtrim(v_url, '/') || '/rest/v1/daily_puzzles', jsonb_build_object('select', 'puzzle_date', 'limit', '1'),
            jsonb_build_object('apikey', v_key), 10000;
  end if;
  return jsonb_build_object('puzzles', v_puzzles, 'request', v_request, 'at', now());
end;
$$;
revoke execute on function private.keepalive_ping() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('touchline-keepalive', '23 5 * * *', 'select private.keepalive_ping()');
  else
    raise notice 'pg_cron is not available: touchline-keepalive not scheduled';
  end if;
end
$$;

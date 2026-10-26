-- The keep-alive (migration keepalive): what private.keepalive_ping() does with and without Vault and pg_net, who
-- may call it, and that it only ever calls this project's own Data API. Runs inside one transaction and rolls back,
-- so the stand-in schemas it adds (vault, net) do not leak into the other suites.
\set ON_ERROR_STOP on
begin;

\echo '--- keepalive: runs its query and makes no request when Vault and pg_net are missing'
do $$
declare r jsonb := private.keepalive_ping();
begin
  if not (r ? 'puzzles') or r ->> 'request' is not null then raise exception 'keepalive without vault: %', r; end if;
end $$;

\echo '--- keepalive: nobody but the owner (the cron job) can call it'
do $$
declare v text;
begin
  foreach v in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(v, 'private.keepalive_ping()', 'execute') then raise exception '% can execute keepalive_ping', v; end if;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'keepalive_ping') then
    raise exception 'keepalive_ping must not be in public';
  end if;
end $$;

-- stand-ins for Supabase Vault and pg_net
create schema vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
create schema net;
create table net.calls (id bigint generated always as identity, url text, params jsonb, headers jsonb, timeout_milliseconds integer);
create function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
returns bigint language sql as $$
  insert into net.calls (url, params, headers, timeout_milliseconds) values (url, params, headers, timeout_milliseconds) returning id
$$;

\echo '--- keepalive: with only one secret it still makes no request'
insert into vault.decrypted_secrets values ('touchline_project_url', 'https://yvqpmyqomkwtudxmkeou.supabase.co');
do $$
declare r jsonb := private.keepalive_ping();
begin
  if r ->> 'request' is not null or exists (select 1 from net.calls) then raise exception 'requested without a key: %', r; end if;
end $$;

\echo '--- keepalive: with both secrets it GETs one row of daily_puzzles from this project with the publishable key'
insert into vault.decrypted_secrets values ('touchline_publishable_key', 'sb_publishable_test');
do $$
declare r jsonb := private.keepalive_ping(); c net.calls%rowtype;
begin
  select * into c from net.calls;
  if r ->> 'request' is null or c.url <> 'https://yvqpmyqomkwtudxmkeou.supabase.co/rest/v1/daily_puzzles'
     or c.params <> '{"select": "puzzle_date", "limit": "1"}'::jsonb or c.headers <> '{"apikey": "sb_publishable_test"}'::jsonb then
    raise exception 'unexpected keepalive request: % %', r, row_to_json(c);
  end if;
end $$;

\echo '--- keepalive: a URL naming any other host is never called'
update vault.decrypted_secrets set decrypted_secret = 'https://hkmpcaalyemfhfohkgbd.supabase.co' where name = 'touchline_project_url';
delete from net.calls;
do $$
declare r jsonb := private.keepalive_ping();
begin
  if r ->> 'request' is not null or exists (select 1 from net.calls) then raise exception 'called another host: %', r; end if;
end $$;
update vault.decrypted_secrets set decrypted_secret = 'https://yvqpmyqomkwtudxmkeou.supabase.co.evil.example' where name = 'touchline_project_url';
do $$
begin
  perform private.keepalive_ping();
  if exists (select 1 from net.calls) then raise exception 'called a look-alike host'; end if;
end $$;

rollback;
\echo 'KEEPALIVE ASSERTIONS PASSED'

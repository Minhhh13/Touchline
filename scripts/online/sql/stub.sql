-- Local stand-in for the parts of a Supabase project the TouchLine migrations touch. NOT a migration.
-- Mirrors the TouchLine project (yvqpmyqomkwtudxmkeou, created 2026-10-24) as its pg_default_acl reads: new
-- tables, sequences and functions in public grant everything to anon, authenticated and service_role, and
-- functions keep Postgres' PUBLIC execute, so an un-revoked table or function is reachable by anon.
\set ON_ERROR_STOP on
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub', '')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create schema realtime;
create table realtime.messages (
  id bigint generated always as identity primary key,
  topic text not null,
  extension text not null,
  payload jsonb,
  event text,
  private boolean default true,
  inserted_at timestamptz not null default now()
);
alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')
$$;
create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into realtime.messages (topic, extension, payload, event, private) values (topic, 'broadcast', payload, event, private);
end $$;
grant usage on schema realtime to anon, authenticated, service_role;
grant select, insert on realtime.messages to anon, authenticated;
grant execute on all functions in schema realtime to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant execute on all functions in schema storage to anon, authenticated, service_role;

-- Test helper: act as a role with given JWT claims for the rest of the current transaction.
create schema test;
create function test.act(p_role text, p_sub uuid, p_anon boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', case when p_sub is null then '{}' else jsonb_build_object('sub', p_sub, 'role', p_role, 'is_anonymous', p_anon)::text end, true);
  execute format('set local role %I', p_role);
end $$;
-- Run a statement and report 'ok' or the SQLSTATE and message instead of aborting the script.
create function test.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;
grant usage on schema test to anon, authenticated, service_role;
grant execute on all functions in schema test to anon, authenticated, service_role;

insert into auth.users (id, email, is_anonymous) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.com', false),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.com', false),
  ('33333333-3333-4333-8333-333333333333', 'carol@example.com', false),
  ('44444444-4444-4444-8444-444444444444', null, true);

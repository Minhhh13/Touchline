-- migration: online_core
-- TouchLine online layer, Phase 1, part 1 of 6: the private schema, shared helpers, rate limits, the
-- data-pack registry with its private bucket, and owner-only profiles (display names and an optional country).
-- Every online migration follows the same rules: RLS on every table (public and private); explicit grants (each
-- public table first revokes what this project's default privileges give anon and authenticated); EXECUTE revoked
-- from PUBLIC/anon/authenticated before any grant; SECURITY DEFINER only in the unexposed private schema, with
-- search_path = '' and its own auth.uid() check; and service-only writers named svc_* that only service_role can
-- execute.

create schema if not exists private;
revoke all on schema private from public;
-- Usage lets RLS policies and SECURITY INVOKER wrappers reach the few private functions granted below.
-- Nothing in private is reachable over the Data API: the schema is never exposed.
grant usage on schema private to anon, authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;

-- ------------------------------------------------------------------ helpers

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function private.touch_updated_at() from public, anon, authenticated;

-- Whether the caller's JWT belongs to an anonymous (guest) session. Guest sign-in is off at launch; every
-- policy that keeps guests out is RESTRICTIVE, so it still holds if guests are switched on later.
create or replace function private.is_anonymous()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;
revoke execute on function private.is_anonymous() from public;
grant execute on function private.is_anonymous() to anon, authenticated, service_role;

-- A random code from the game's own seed alphabet (no I, O, 0 or 1): 8 characters carry 40 bits. Only the
-- fully random bytes of a v4 UUID are used (bytes 6 and 8 carry the version and variant bits).
create or replace function private.random_code(p_len integer)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  idx constant integer[] := array[0, 1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13, 14, 15];
  b bytea := uuid_send(gen_random_uuid());
  v_code text := '';
begin
  if p_len is null or p_len < 1 or p_len > array_length(idx, 1) then
    raise exception 'code length out of range' using errcode = '22023';
  end if;
  for i in 1 .. p_len loop
    v_code := v_code || substr(alphabet, (get_byte(b, idx[i]) % 32) + 1, 1);
  end loop;
  return v_code;
end;
$$;
revoke execute on function private.random_code(integer) from public, anon, authenticated;
grant execute on function private.random_code(integer) to service_role;

-- A code as a person typed or pasted it: separators and spaces dropped, upper case; null when absurd.
create or replace function private.normalise_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_code is null or char_length(p_code) > 24 then null
              else upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g')) end
$$;
revoke execute on function private.normalise_code(text) from public;
grant execute on function private.normalise_code(text) to anon, authenticated, service_role;

-- ------------------------------------------------------------- rate limits
-- Fixed windows per (bucket, subject). A cost above 1 meters bytes rather than calls.

create table if not exists private.rate_limits (
  bucket text not null,
  subject uuid not null,
  window_start timestamptz not null,
  hits bigint not null default 0,
  primary key (bucket, subject, window_start)
);
alter table private.rate_limits enable row level security;
revoke all on private.rate_limits from public, anon, authenticated;
grant select, insert, update, delete on private.rate_limits to service_role;

create or replace function private.take_rate_limit(p_bucket text, p_subject uuid, p_limit bigint, p_window_seconds integer, p_cost bigint default 1)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits bigint;
begin
  if p_subject is null or p_limit < 1 or p_window_seconds < 1 or p_cost < 0 then
    return false;
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into private.rate_limits as r (bucket, subject, window_start, hits)
  values (p_bucket, p_subject, v_window, p_cost)
  on conflict (bucket, subject, window_start) do update set hits = r.hits + p_cost
  returning r.hits into v_hits;
  return v_hits <= p_limit;
end;
$$;
revoke execute on function private.take_rate_limit(text, uuid, bigint, integer, bigint) from public, anon, authenticated;
grant execute on function private.take_rate_limit(text, uuid, bigint, integer, bigint) to service_role;

-- The Edge Function's own per-route limits.
create or replace function public.svc_take_rate_limit(p_bucket text, p_subject uuid, p_limit bigint, p_window_seconds integer, p_cost bigint default 1)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.take_rate_limit(p_bucket, p_subject, p_limit, p_window_seconds, p_cost)
$$;
revoke execute on function public.svc_take_rate_limit(text, uuid, bigint, integer, bigint) from public, anon, authenticated;
grant execute on function public.svc_take_rate_limit(text, uuid, bigint, integer, bigint) to service_role;

-- ------------------------------------------------------- data-pack registry
-- The Edge Function copies every data version the live site serves into the private `packs` bucket
-- (v/<generatedAt>/leagues.json and v/<generatedAt>/<league>/{players,meta}.json) the first time it sees it,
-- and registers the file hashes here. A version is never re-registered with different bytes.

insert into storage.buckets (id, name, public)
values ('packs', 'packs', false)
on conflict (id) do nothing;
-- No storage.objects policy names this bucket: only the service role can read or write it.

create table if not exists private.data_packs (
  version text primary key check (version ~ '^[0-9A-Za-z._:-]{1,40}$'),
  leagues text[] not null check (cardinality(leagues) between 1 and 32),
  files jsonb not null check (jsonb_typeof(files) = 'object' and pg_column_size(files) <= 16384),
  first_seen_at timestamptz not null default now()
);
alter table private.data_packs enable row level security;
revoke all on private.data_packs from public, anon, authenticated;
grant select, insert on private.data_packs to service_role;

create or replace function public.svc_register_data_pack(p_version text, p_leagues text[], p_files jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v private.data_packs%rowtype;
begin
  insert into private.data_packs (version, leagues, files) values (p_version, p_leagues, p_files)
  on conflict (version) do nothing;
  select * into v from private.data_packs d where d.version = p_version;
  return jsonb_build_object(
    'status', case when v.files = p_files then 'ok' else 'mismatch' end,
    'version', v.version, 'leagues', to_jsonb(v.leagues), 'files', v.files, 'firstSeenAt', v.first_seen_at);
end;
$$;
revoke execute on function public.svc_register_data_pack(text, text[], jsonb) from public, anon, authenticated;
grant execute on function public.svc_register_data_pack(text, text[], jsonb) to service_role;

create or replace function public.svc_data_pack(p_version text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object('version', d.version, 'leagues', to_jsonb(d.leagues), 'files', d.files, 'firstSeenAt', d.first_seen_at)
  from private.data_packs d
  where d.version = p_version
$$;
revoke execute on function public.svc_data_pack(text) from public, anon, authenticated;
grant execute on function public.svc_data_pack(text) to service_role;

-- ------------------------------------------------------------------ profiles
-- One display name per account, readable only by its owner, and an optional country (ISO 3166-1 alpha-2, upper
-- case: 'GB', 'VN') for the flag and the country filter on the boards. Public boards carry a copy of the name and
-- the country taken when the row was posted, never a user id. Names are unique ignoring case.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_shape check (
    char_length(display_name) between 3 and 24
    and display_name = btrim(display_name)
    and display_name !~ '[[:cntrl:]]'
    and display_name !~ '\s\s'
    and display_name !~ '[<>]'
  ),
  constraint profiles_country_shape check (country is null or country ~ '^[A-Z]{2}$')
);
create unique index if not exists profiles_display_name_lower_key on public.profiles (lower(display_name));
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function private.touch_updated_at();

alter table public.profiles enable row level security;
-- the project's default privileges grant every new public table to anon and authenticated: start from nothing
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (user_id, display_name, country), update (display_name, country) on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;

create policy profiles_select_own on public.profiles for select to authenticated
using (user_id = (select auth.uid()));
create policy profiles_insert_own on public.profiles for insert to authenticated
with check (user_id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
create policy profiles_no_guests on public.profiles as restrictive for all to authenticated
using (not (select private.is_anonymous()))
with check (not (select private.is_anonymous()));

-- The name a ranked entry is filed under: the player's own, or a default assigned once ("Manager K7Q2M").
create or replace function private.ensure_display_name(p_user uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_name text;
begin
  select p.display_name into v_name from public.profiles p where p.user_id = p_user;
  if found then
    return v_name;
  end if;
  for i in 1 .. 8 loop
    v_name := 'Manager ' || private.random_code(5);
    insert into public.profiles (user_id, display_name) values (p_user, v_name) on conflict do nothing;
    if found then
      return v_name;
    end if;
    select p.display_name into v_name from public.profiles p where p.user_id = p_user;
    if found then
      return v_name;
    end if;
  end loop;
  raise exception 'could not allocate a display name' using errcode = 'PT503';
end;
$$;
revoke execute on function private.ensure_display_name(uuid) from public, anon, authenticated;
grant execute on function private.ensure_display_name(uuid) to service_role;

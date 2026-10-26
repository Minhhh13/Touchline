-- migration: challenge_codes
-- TouchLine online layer, Phase 1, part 5 of 6: short challenge codes (#s=K7Q2MX9A).
-- The payload is the existing ChallengePayload (src/engine/challenge.ts, v: 1) stored as jsonb. The server
-- bounds its shape and size only; whoever opens a code replays it on their own device exactly as a #c= link
-- (decodeChallenge, then replayChallenge), so the server never vouches for a claim here. Clients cannot insert
-- rows: create_challenge draws the code and the hash and engine/data stamps are generated columns.

create or replace function private.valid_challenge_payload(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  s jsonb;
  c jsonb;
  r jsonb;
  item jsonb;
  k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' or pg_column_size(p) > 8192 then
    return false;
  end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('v', 'data', 'engine', 'name', 's', 'p', 'c', 'k', 'x') then
      return false;
    end if;
  end loop;
  if jsonb_typeof(p -> 'v') is distinct from 'number' or (p ->> 'v') <> '1' then
    return false;
  end if;
  if jsonb_typeof(p -> 'data') is distinct from 'string' or char_length(p ->> 'data') > 40
     or jsonb_typeof(p -> 'engine') is distinct from 'string' or char_length(p ->> 'engine') > 16
     or jsonb_typeof(p -> 'name') is distinct from 'string' or char_length(p ->> 'name') > 24
     or jsonb_typeof(p -> 'k') is distinct from 'string' or char_length(p ->> 'k') > 16 then
    return false;
  end if;
  -- the season-choices block (tactics, January deal) of the replica-setup branch: bounded here, validated
  -- exactly by decodeChallenge on the opener's device
  if p ? 'x' and (jsonb_typeof(p -> 'x') is distinct from 'object' or pg_column_size(p -> 'x') > 3072) then
    return false;
  end if;
  s := p -> 's';
  if jsonb_typeof(s) is distinct from 'object' then
    return false;
  end if;
  for k in select jsonb_object_keys(s) loop
    if k not in ('seed', 'f', 'l', 'wl', 'h', 'ls', 'd', 'r') then
      return false;
    end if;
  end loop;
  if jsonb_typeof(s -> 'seed') is distinct from 'string' or char_length(s ->> 'seed') not between 1 and 64
     or jsonb_typeof(s -> 'f') is distinct from 'string' or char_length(s ->> 'f') > 24
     or jsonb_typeof(s -> 'l') is distinct from 'string' or char_length(s ->> 'l') > 32
     or jsonb_typeof(s -> 'h') is distinct from 'string' or char_length(s ->> 'h') > 64
     or jsonb_typeof(s -> 'ls') is distinct from 'number' or (s ->> 'ls') !~ '^[0-9]{4}$'
     or ((s ->> 'd') is distinct from 'calibrated' and (s ->> 'd') is distinct from 'realistic') then
    return false;
  end if;
  if jsonb_typeof(s -> 'wl') is distinct from 'array' or jsonb_array_length(s -> 'wl') not between 1 and 12 then
    return false;
  end if;
  for item in select * from jsonb_array_elements(s -> 'wl') loop
    if jsonb_typeof(item) is distinct from 'string' or char_length(item #>> '{}') > 32 then
      return false;
    end if;
  end loop;
  -- The rules diff gains keys whenever DraftRules does (RULE_CHECKS on the client checks each one exactly),
  -- so the server bounds its shape only: up to 24 camelCase keys with scalar values, never `leagues`.
  r := s -> 'r';
  if jsonb_typeof(r) is distinct from 'object' or (select count(*) from jsonb_object_keys(r)) > 24 then
    return false;
  end if;
  for k in select jsonb_object_keys(r) loop
    if k !~ '^[a-z][A-Za-z0-9]{0,31}$' or k = 'leagues'
       or jsonb_typeof(r -> k) not in ('boolean', 'number', 'string')
       or (jsonb_typeof(r -> k) = 'string' and char_length(r ->> k) > 64) then
      return false;
    end if;
  end loop;
  if jsonb_typeof(p -> 'p') is distinct from 'array' or jsonb_array_length(p -> 'p') not between 1 and 40 then
    return false;
  end if;
  for item in select * from jsonb_array_elements(p -> 'p') loop
    if jsonb_typeof(item) is distinct from 'array' or jsonb_array_length(item) <> 2
       or jsonb_typeof(item -> 0) not in ('string', 'null') or jsonb_typeof(item -> 1) not in ('string', 'null')
       or char_length(coalesce(item ->> 0, '')) > 32 or char_length(coalesce(item ->> 1, '')) > 16 then
      return false;
    end if;
  end loop;
  c := p -> 'c';
  if jsonb_typeof(c) is distinct from 'object'
     or jsonb_typeof(c -> 'pts') is distinct from 'number' or jsonb_typeof(c -> 'w') is distinct from 'number'
     or jsonb_typeof(c -> 'd') is distinct from 'number' or jsonb_typeof(c -> 'l') is distinct from 'number'
     or (c ->> 't') is null
     or (c ->> 't') not in ('PERFECT', 'INVINCIBLE', 'CHAMPIONS', 'TITLE_RACE', 'EUROPEAN', 'MID_TABLE', 'RELEGATION_BATTLE', 'RELEGATED') then
    return false;
  end if;
  return true;
end;
$$;
revoke execute on function private.valid_challenge_payload(jsonb) from public, anon;
grant execute on function private.valid_challenge_payload(jsonb) to authenticated, service_role;

create table if not exists public.challenges (
  code text primary key check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  payload jsonb not null check (private.valid_challenge_payload(payload)),
  payload_hash text generated always as (md5(payload::text)) stored,
  engine_version text generated always as (payload ->> 'engine') stored,
  data_version text generated always as (payload ->> 'data') stored,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 year'),
  unique (owner_id, payload_hash)
);
comment on table public.challenges is 'Short codes for ghost-draft links. Owners list and delete their own; anyone resolves one exact code through get_challenge.';
create index if not exists challenges_owner_created_idx on public.challenges (owner_id, created_at desc);
create index if not exists challenges_expires_at_idx on public.challenges (expires_at);
alter table public.challenges enable row level security;
-- the project's default privileges grant every new public table to anon and authenticated: start from nothing
revoke all on public.challenges from public, anon, authenticated;
grant select, delete on public.challenges to authenticated;
grant select, insert, update, delete on public.challenges to service_role;
create policy challenges_select_own on public.challenges for select to authenticated
using (owner_id = (select auth.uid()));
create policy challenges_delete_own on public.challenges for delete to authenticated
using (owner_id = (select auth.uid()));

-- Create (or return the existing) code for a payload: the same payload from the same owner gets the same
-- code, so retries and double taps are free. 30 new codes a day per account.
create or replace function private.create_challenge_impl(p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text;
begin
  if v_uid is null then
    raise exception 'sign in to make a short link' using errcode = 'PT401';
  end if;
  if (select private.is_anonymous()) then
    raise exception 'guest sessions cannot make short links' using errcode = 'PT403';
  end if;
  if not private.valid_challenge_payload(p_payload) then
    raise exception 'not a TouchLine challenge' using errcode = '22023';
  end if;
  select c.code into v_code from public.challenges c where c.owner_id = v_uid and c.payload_hash = md5(p_payload::text);
  if found then
    return v_code;
  end if;
  if not private.take_rate_limit('challenge.create', v_uid, 30, 86400) then
    raise exception 'too many short links today' using errcode = 'PT429';
  end if;
  for i in 1 .. 6 loop
    v_code := private.random_code(8);
    insert into public.challenges (code, owner_id, payload) values (v_code, v_uid, p_payload)
    on conflict do nothing;
    if found then
      return v_code;
    end if;
    -- the same payload raced in from another tab (return it) or the code collided (draw again)
    select c.code into v_code from public.challenges c where c.owner_id = v_uid and c.payload_hash = md5(p_payload::text);
    if found then
      return v_code;
    end if;
  end loop;
  raise exception 'could not allocate a code' using errcode = 'PT503';
end;
$$;
revoke execute on function private.create_challenge_impl(jsonb) from public, anon;
grant execute on function private.create_challenge_impl(jsonb) to authenticated;

create or replace function public.create_challenge(p_payload jsonb)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.create_challenge_impl(p_payload)
$$;
revoke execute on function public.create_challenge(jsonb) from public, anon;
grant execute on function public.create_challenge(jsonb) to authenticated;

-- Resolve one exact code (typed in any case, with or without the dash) for anyone, signed in or not.
-- Returns one payload or null; there is no way to list codes that are not your own.
create or replace function private.get_challenge_impl(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select c.payload
  from public.challenges c
  where c.code = private.normalise_code(p_code) and c.expires_at > now()
$$;
revoke execute on function private.get_challenge_impl(text) from public;
grant execute on function private.get_challenge_impl(text) to anon, authenticated, service_role;

create or replace function public.get_challenge(p_code text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_challenge_impl(p_code)
$$;
revoke execute on function public.get_challenge(text) from public;
grant execute on function public.get_challenge(text) to anon, authenticated, service_role;

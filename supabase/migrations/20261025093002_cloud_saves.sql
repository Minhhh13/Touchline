-- migration: cloud_saves
-- TouchLine online layer, Phase 1, part 2 of 6: cloud saves.
-- The bytes live in the private `saves` bucket at <uid>/<slot>/<millis>-<hash16>.json.gz (gzip of the slot's
-- JSON). public.cloud_saves holds one compare-and-set row per (user, slot) pointing at the current object and
-- at exactly one previous copy. Clients read their own rows and objects; every row write goes through
-- save_claim / save_delete / profile_put, which check the revision under a row lock.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('saves', 'saves', false, 8388608, array['application/gzip', 'application/octet-stream'])
on conflict (id) do nothing;

-- Objects one user keeps in the bucket. Current plus previous for four slots is 8; the cap of 16 leaves room
-- for uploads in flight and for orphans the client sweeps.
create or replace function private.save_object_count(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from storage.objects o
  where o.bucket_id = 'saves' and (storage.foldername(o.name))[1] = p_user::text
$$;
revoke execute on function private.save_object_count(uuid) from public, anon;
grant execute on function private.save_object_count(uuid) to authenticated, service_role;

create policy "saves: owners read their own objects" on storage.objects for select to authenticated
using (bucket_id = 'saves' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "saves: owners upload into their own slots" on storage.objects for insert to authenticated
with check (
  bucket_id = 'saves'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ '^[0-9a-f-]{36}/(quick|season|dynasty|h2h)/[0-9]{1,13}-[0-9a-f]{16}[.]json[.]gz$'
  and (select private.save_object_count((select auth.uid()))) < 16
);

create policy "saves: owners delete their own objects" on storage.objects for delete to authenticated
using (bucket_id = 'saves' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- No update policy: objects are immutable (every upload gets a new name), so upsert and move are refused.
create policy "saves: no guest uploads" on storage.objects as restrictive for insert to authenticated
with check (bucket_id <> 'saves' or not (select private.is_anonymous()));

create table if not exists public.cloud_saves (
  user_id uuid not null references auth.users (id) on delete cascade,
  slot text not null check (slot in ('quick', 'season', 'dynasty', 'h2h')),
  revision bigint not null check (revision >= 1),
  game_id text not null check (char_length(game_id) between 1 and 120),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  object_path text check (char_length(object_path) <= 200),
  bytes integer check (bytes between 1 and 8388608),
  raw_bytes integer check (raw_bytes between 1 and 67108864),
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 2048),
  device_id text not null check (char_length(device_id) between 8 and 64),
  client_saved_at timestamptz,
  -- set when the slot was abandoned on purpose on some device: the game's id and hash stay so other
  -- devices know which game went, and the copy itself moves to prev_* (restorable)
  deleted_at timestamptz,
  prev_revision bigint,
  prev_game_id text,
  prev_content_hash text,
  prev_object_path text,
  prev_meta jsonb,
  prev_saved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, slot),
  constraint cloud_saves_live_or_tombstone check (
    (deleted_at is null and object_path is not null and bytes is not null and raw_bytes is not null)
    or (deleted_at is not null and object_path is null and bytes is null and raw_bytes is null)
  )
);
comment on table public.cloud_saves is 'One row per user and save slot: the current gzip object of that slot and one previous copy. Written only by private.save_claim_impl / save_delete_impl.';
alter table public.cloud_saves enable row level security;
-- the project's default privileges grant every new public table to anon and authenticated: start from nothing
revoke all on public.cloud_saves from public, anon, authenticated;
grant select on public.cloud_saves to authenticated;
grant select, insert, update, delete on public.cloud_saves to service_role;
create policy cloud_saves_select_own on public.cloud_saves for select to authenticated
using (user_id = (select auth.uid()));

-- The synced profile document: { v, profile, shortlist, prefsAt }, merged on the client (grow-only sets,
-- counters as maximum, three-way preferences), stored whole with a revision.
create table if not exists public.cloud_profile (
  user_id uuid primary key references auth.users (id) on delete cascade,
  revision bigint not null check (revision >= 1),
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 262144),
  device_id text not null check (char_length(device_id) between 8 and 64),
  updated_at timestamptz not null default now()
);
alter table public.cloud_profile enable row level security;
-- the project's default privileges grant every new public table to anon and authenticated: start from nothing
revoke all on public.cloud_profile from public, anon, authenticated;
grant select on public.cloud_profile to authenticated;
grant select, insert, update, delete on public.cloud_profile to service_role;
create policy cloud_profile_select_own on public.cloud_profile for select to authenticated
using (user_id = (select auth.uid()));

-- ------------------------------------------------------------------ writers

-- Compare-and-set claim of an uploaded object. p_base_revision is the revision this device last saw (0 = none).
-- Normal claim: the current copy becomes the previous one and the old previous object is returned in
-- `obsolete` for the client to delete. p_as_previous: keep the current copy and file the upload as the
-- previous one (how a lost conflict is kept without a second upload). Identical content is 'unchanged'.
create or replace function private.save_claim_impl(
  p_slot text, p_base_revision bigint, p_game_id text, p_content_hash text, p_object_path text,
  p_bytes integer, p_raw_bytes integer, p_meta jsonb, p_device_id text, p_client_saved_at timestamptz,
  p_as_previous boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cur public.cloud_saves%rowtype;
  v_row public.cloud_saves%rowtype;
  v_obsolete jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'sign in to save to the cloud' using errcode = 'PT401';
  end if;
  if (select private.is_anonymous()) then
    raise exception 'guest sessions do not keep cloud saves' using errcode = 'PT403';
  end if;
  if p_slot is null or p_slot not in ('quick', 'season', 'dynasty', 'h2h') then
    raise exception 'unknown save slot' using errcode = '22023';
  end if;
  if p_object_path is null or p_object_path !~ ('^' || v_uid::text || '/' || p_slot || '/[0-9]{1,13}-[0-9a-f]{16}[.]json[.]gz$') then
    raise exception 'the object must sit in your own folder for this slot' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'saves' and o.name = p_object_path) then
    raise exception 'upload the save before claiming it' using errcode = '22023';
  end if;
  if not private.take_rate_limit('cloud.claims', v_uid, 60, 3600) then
    raise exception 'too many cloud saves this hour; the next one retries later' using errcode = 'PT429';
  end if;
  if not private.take_rate_limit('cloud.bytes', v_uid, 33554432, 3600, greatest(coalesce(p_bytes, 0), 0)) then
    raise exception 'too much cloud data this hour; the next save retries later' using errcode = 'PT429';
  end if;

  select * into v_cur from public.cloud_saves s where s.user_id = v_uid and s.slot = p_slot for update;
  if not found then
    if coalesce(p_base_revision, -1) <> 0 or coalesce(p_as_previous, false) then
      return jsonb_build_object('status', 'conflict', 'revision', 0);
    end if;
    insert into public.cloud_saves (user_id, slot, revision, game_id, content_hash, object_path, bytes, raw_bytes, meta, device_id, client_saved_at)
    values (v_uid, p_slot, 1, p_game_id, p_content_hash, p_object_path, p_bytes, p_raw_bytes, coalesce(p_meta, '{}'::jsonb), p_device_id, p_client_saved_at)
    on conflict (user_id, slot) do nothing
    returning * into v_row;
    if not found then
      -- another device's first upload landed a moment earlier: refetch and plan again
      return jsonb_build_object('status', 'conflict', 'revision', -1);
    end if;
    return jsonb_build_object('status', 'ok', 'revision', v_row.revision, 'obsolete', v_obsolete);
  end if;

  if v_cur.revision <> p_base_revision then
    return jsonb_build_object('status', 'conflict', 'revision', v_cur.revision, 'gameId', v_cur.game_id,
      'contentHash', v_cur.content_hash, 'meta', v_cur.meta, 'deviceId', v_cur.device_id,
      'deleted', v_cur.deleted_at is not null, 'updatedAt', v_cur.updated_at);
  end if;

  if coalesce(p_as_previous, false) then
    if v_cur.prev_object_path is not null then
      v_obsolete := jsonb_build_array(v_cur.prev_object_path);
    end if;
    update public.cloud_saves s
       set prev_revision = null, prev_game_id = p_game_id, prev_content_hash = p_content_hash,
           prev_object_path = p_object_path, prev_meta = coalesce(p_meta, '{}'::jsonb), prev_saved_at = now(),
           updated_at = now()
     where s.user_id = v_uid and s.slot = p_slot;
    return jsonb_build_object('status', 'archived', 'revision', v_cur.revision, 'obsolete', v_obsolete);
  end if;

  if v_cur.deleted_at is null and v_cur.game_id = p_game_id and v_cur.content_hash = p_content_hash then
    return jsonb_build_object('status', 'unchanged', 'revision', v_cur.revision,
      'obsolete', case when p_object_path <> v_cur.object_path then jsonb_build_array(p_object_path) else '[]'::jsonb end);
  end if;

  if v_cur.deleted_at is null then
    -- the current copy becomes the previous one; the old previous object goes
    if v_cur.prev_object_path is not null then
      v_obsolete := jsonb_build_array(v_cur.prev_object_path);
    end if;
    update public.cloud_saves s
       set prev_revision = v_cur.revision, prev_game_id = v_cur.game_id, prev_content_hash = v_cur.content_hash,
           prev_object_path = v_cur.object_path, prev_meta = v_cur.meta, prev_saved_at = v_cur.updated_at
     where s.user_id = v_uid and s.slot = p_slot;
  end if;
  -- (over a tombstone the deleted game stays as the previous copy)
  update public.cloud_saves s
     set revision = v_cur.revision + 1, game_id = p_game_id, content_hash = p_content_hash, object_path = p_object_path,
         bytes = p_bytes, raw_bytes = p_raw_bytes, meta = coalesce(p_meta, '{}'::jsonb), device_id = p_device_id,
         client_saved_at = p_client_saved_at, deleted_at = null, updated_at = now()
   where s.user_id = v_uid and s.slot = p_slot
  returning * into v_row;
  return jsonb_build_object('status', 'ok', 'revision', v_row.revision, 'obsolete', v_obsolete);
end;
$$;
revoke execute on function private.save_claim_impl(text, bigint, text, text, text, integer, integer, jsonb, text, timestamptz, boolean) from public, anon;
grant execute on function private.save_claim_impl(text, bigint, text, text, text, integer, integer, jsonb, text, timestamptz, boolean) to authenticated;

create or replace function public.save_claim(
  p_slot text, p_base_revision bigint, p_game_id text, p_content_hash text, p_object_path text,
  p_bytes integer, p_raw_bytes integer, p_meta jsonb, p_device_id text, p_client_saved_at timestamptz,
  p_as_previous boolean default false)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.save_claim_impl(p_slot, p_base_revision, p_game_id, p_content_hash, p_object_path, p_bytes,
    p_raw_bytes, p_meta, p_device_id, p_client_saved_at, p_as_previous)
$$;
revoke execute on function public.save_claim(text, bigint, text, text, text, integer, integer, jsonb, text, timestamptz, boolean) from public, anon;
grant execute on function public.save_claim(text, bigint, text, text, text, integer, integer, jsonb, text, timestamptz, boolean) to authenticated;

-- An explicit abandon or discard on some device: the slot becomes a tombstone that keeps the game's id
-- (so other devices can ask before dropping their copy) and keeps the copy itself as the previous one.
create or replace function private.save_delete_impl(p_slot text, p_base_revision bigint, p_device_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cur public.cloud_saves%rowtype;
  v_obsolete jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = 'PT401';
  end if;
  if (select private.is_anonymous()) then
    raise exception 'guest sessions do not keep cloud saves' using errcode = 'PT403';
  end if;
  if not private.take_rate_limit('cloud.claims', v_uid, 60, 3600) then
    raise exception 'too many cloud saves this hour' using errcode = 'PT429';
  end if;
  select * into v_cur from public.cloud_saves s where s.user_id = v_uid and s.slot = p_slot for update;
  if not found or v_cur.deleted_at is not null then
    return jsonb_build_object('status', 'unchanged', 'revision', coalesce(v_cur.revision, 0));
  end if;
  if v_cur.revision <> p_base_revision then
    return jsonb_build_object('status', 'conflict', 'revision', v_cur.revision, 'gameId', v_cur.game_id,
      'contentHash', v_cur.content_hash, 'meta', v_cur.meta, 'deviceId', v_cur.device_id, 'updatedAt', v_cur.updated_at);
  end if;
  if v_cur.prev_object_path is not null then
    v_obsolete := jsonb_build_array(v_cur.prev_object_path);
  end if;
  update public.cloud_saves s
     set prev_revision = v_cur.revision, prev_game_id = v_cur.game_id, prev_content_hash = v_cur.content_hash,
         prev_object_path = v_cur.object_path, prev_meta = v_cur.meta, prev_saved_at = v_cur.updated_at,
         revision = v_cur.revision + 1, object_path = null, bytes = null, raw_bytes = null,
         deleted_at = now(), device_id = coalesce(p_device_id, v_cur.device_id), updated_at = now()
   where s.user_id = v_uid and s.slot = p_slot;
  return jsonb_build_object('status', 'ok', 'revision', v_cur.revision + 1, 'obsolete', v_obsolete);
end;
$$;
revoke execute on function private.save_delete_impl(text, bigint, text) from public, anon;
grant execute on function private.save_delete_impl(text, bigint, text) to authenticated;

create or replace function public.save_delete(p_slot text, p_base_revision bigint, p_device_id text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.save_delete_impl(p_slot, p_base_revision, p_device_id)
$$;
revoke execute on function public.save_delete(text, bigint, text) from public, anon;
grant execute on function public.save_delete(text, bigint, text) to authenticated;

-- Objects in the caller's folder that no row points at any more (lost compare-and-set races, crashed
-- uploads). Fifteen minutes old at least, so an upload in flight is never swept. The client deletes them.
create or replace function private.save_orphans_impl()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'saves'
    and (storage.foldername(o.name))[1] = (select auth.uid())::text
    and o.created_at < now() - interval '15 minutes'
    and not exists (
      select 1 from public.cloud_saves s
      where s.user_id = (select auth.uid()) and (s.object_path = o.name or s.prev_object_path = o.name)
    )
  order by o.created_at
  limit 50
$$;
revoke execute on function private.save_orphans_impl() from public, anon;
grant execute on function private.save_orphans_impl() to authenticated;

create or replace function public.save_orphans()
returns setof text
language sql
stable
security invoker
set search_path = ''
as $$
  select private.save_orphans_impl()
$$;
revoke execute on function public.save_orphans() from public, anon;
grant execute on function public.save_orphans() to authenticated;

-- "Delete my cloud data": drops every row and returns the object names for the client to remove.
create or replace function private.cloud_delete_all_impl()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_paths jsonb;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = 'PT401';
  end if;
  select coalesce(jsonb_agg(x.p), '[]'::jsonb) into v_paths
  from (
    select s.object_path as p from public.cloud_saves s where s.user_id = v_uid and s.object_path is not null
    union
    select s.prev_object_path from public.cloud_saves s where s.user_id = v_uid and s.prev_object_path is not null
  ) x;
  delete from public.cloud_saves s where s.user_id = v_uid;
  delete from public.cloud_profile c where c.user_id = v_uid;
  return jsonb_build_object('status', 'ok', 'objects', v_paths);
end;
$$;
revoke execute on function private.cloud_delete_all_impl() from public, anon;
grant execute on function private.cloud_delete_all_impl() to authenticated;

create or replace function public.cloud_delete_all()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.cloud_delete_all_impl()
$$;
revoke execute on function public.cloud_delete_all() from public, anon;
grant execute on function public.cloud_delete_all() to authenticated;

-- Profile document: compare-and-set; a conflict returns the cloud document so the client merges and retries.
create or replace function private.profile_put_impl(p_base_revision bigint, p_data jsonb, p_device_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cur public.cloud_profile%rowtype;
  v_rev bigint;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = 'PT401';
  end if;
  if (select private.is_anonymous()) then
    raise exception 'guest sessions do not keep a cloud profile' using errcode = 'PT403';
  end if;
  if not private.take_rate_limit('cloud.profile', v_uid, 120, 3600) then
    raise exception 'too many profile saves this hour' using errcode = 'PT429';
  end if;
  select * into v_cur from public.cloud_profile c where c.user_id = v_uid for update;
  if found then
    if v_cur.data = p_data then
      return jsonb_build_object('status', 'unchanged', 'revision', v_cur.revision);
    end if;
    if v_cur.revision <> p_base_revision then
      return jsonb_build_object('status', 'conflict', 'revision', v_cur.revision, 'data', v_cur.data);
    end if;
    update public.cloud_profile c
       set revision = c.revision + 1, data = p_data, device_id = p_device_id, updated_at = now()
     where c.user_id = v_uid
    returning c.revision into v_rev;
    return jsonb_build_object('status', 'ok', 'revision', v_rev);
  end if;
  if coalesce(p_base_revision, -1) <> 0 then
    return jsonb_build_object('status', 'conflict', 'revision', 0, 'data', null);
  end if;
  insert into public.cloud_profile (user_id, revision, data, device_id) values (v_uid, 1, p_data, p_device_id)
  on conflict (user_id) do nothing
  returning revision into v_rev;
  if v_rev is null then
    select * into v_cur from public.cloud_profile c where c.user_id = v_uid;
    return jsonb_build_object('status', 'conflict', 'revision', v_cur.revision, 'data', v_cur.data);
  end if;
  return jsonb_build_object('status', 'ok', 'revision', v_rev);
end;
$$;
revoke execute on function private.profile_put_impl(bigint, jsonb, text) from public, anon;
grant execute on function private.profile_put_impl(bigint, jsonb, text) to authenticated;

create or replace function public.profile_put(p_base_revision bigint, p_data jsonb, p_device_id text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.profile_put_impl(p_base_revision, p_data, p_device_id)
$$;
revoke execute on function public.profile_put(bigint, jsonb, text) from public, anon;
grant execute on function public.profile_put(bigint, jsonb, text) to authenticated;

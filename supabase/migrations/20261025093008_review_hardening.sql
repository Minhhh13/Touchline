-- migration: review_hardening
-- TouchLine online layer, Phase 1: fixes from the adversarial review of 2026-10-25. A forward migration (it
-- replaces functions and constraints rather than editing the earlier files) so it applies the same way whether
-- or not the earlier Phase 1 migrations had reached the project when the review ran.
--  1. Compare-and-set: save_claim, save_delete and profile_put compared the base revision with `<>`, so a null
--     base skipped the check and overwrote the newer copy. They now use `is distinct from`, and save_delete
--     checks the slot name.
--  2. A claim never reports an object as obsolete (for the client to delete) while the row still points at it,
--     and filing the current object as its own previous copy is refused.
--  3. private.save_object_count took any user id; it now counts the caller's objects only.
--  4. Display names and team names refuse invisible, direction-changing and exotic space characters
--     (zero-width spaces, bidi overrides, byte-order marks, no-break spaces), which let a name look like
--     someone else's while passing the case-insensitive uniqueness check.

-- ------------------------------------------------------------- 4. clean names

-- True when a name holds only characters that render as themselves: no C0/C1 controls, no soft hyphen or
-- combining grapheme joiner, no zero-width or bidi formatting characters, no space other than U+0020, no
-- variation selectors, byte-order mark, Hangul fillers or specials.
create or replace function private.is_clean_name(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null
     and p !~ '[\u0000-\u001f\u007f-\u00a0\u00ad\u034f\u061c\u115f\u1160\u1680\u17b4\u17b5\u180b-\u180f\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff]'
$$;
revoke execute on function private.is_clean_name(text) from public;
grant execute on function private.is_clean_name(text) to anon, authenticated, service_role;

alter table public.profiles drop constraint if exists profiles_display_name_clean;
alter table public.profiles add constraint profiles_display_name_clean check (private.is_clean_name(display_name));
alter table private.daily_entries drop constraint if exists daily_entries_team_name_clean;
alter table private.daily_entries add constraint daily_entries_team_name_clean check (private.is_clean_name(team_name));
alter table private.weekly_entries drop constraint if exists weekly_entries_team_name_clean;
alter table private.weekly_entries add constraint weekly_entries_team_name_clean check (private.is_clean_name(team_name));

-- ------------------------------------------------------ 3. the object cap

drop policy if exists "saves: owners upload into their own slots" on storage.objects;

create or replace function private.save_object_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from storage.objects o
  where o.bucket_id = 'saves' and (storage.foldername(o.name))[1] = (select auth.uid())::text
$$;
revoke execute on function private.save_object_count() from public, anon;
grant execute on function private.save_object_count() to authenticated, service_role;

create policy "saves: owners upload into their own slots" on storage.objects for insert to authenticated
with check (
  bucket_id = 'saves'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ '^[0-9a-f-]{36}/(quick|season|dynasty|h2h)/[0-9]{1,13}-[0-9a-f]{16}[.]json[.]gz$'
  and (select private.save_object_count()) < 16
);

drop function if exists private.save_object_count(uuid);

-- ------------------------------------------------ 1 and 2. compare-and-set

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
  v_old_prev text;
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
    if p_base_revision is distinct from 0 or coalesce(p_as_previous, false) then
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
    return jsonb_build_object('status', 'ok', 'revision', v_row.revision, 'obsolete', '[]'::jsonb);
  end if;

  if v_cur.revision is distinct from p_base_revision then
    return jsonb_build_object('status', 'conflict', 'revision', v_cur.revision, 'gameId', v_cur.game_id,
      'contentHash', v_cur.content_hash, 'meta', v_cur.meta, 'deviceId', v_cur.device_id,
      'deleted', v_cur.deleted_at is not null, 'updatedAt', v_cur.updated_at);
  end if;
  v_old_prev := v_cur.prev_object_path;

  if coalesce(p_as_previous, false) then
    if p_object_path is not distinct from v_cur.object_path then
      raise exception 'that object is already the current copy' using errcode = '22023';
    end if;
    update public.cloud_saves s
       set prev_revision = null, prev_game_id = p_game_id, prev_content_hash = p_content_hash,
           prev_object_path = p_object_path, prev_meta = coalesce(p_meta, '{}'::jsonb), prev_saved_at = now(),
           updated_at = now()
     where s.user_id = v_uid and s.slot = p_slot
    returning * into v_row;
    return jsonb_build_object('status', 'archived', 'revision', v_row.revision,
      'obsolete', private.save_obsolete(v_old_prev, v_row));
  end if;

  if v_cur.deleted_at is null and v_cur.game_id = p_game_id and v_cur.content_hash = p_content_hash then
    -- the upload duplicates the current copy: it goes, unless a row still points at it
    return jsonb_build_object('status', 'unchanged', 'revision', v_cur.revision,
      'obsolete', private.save_obsolete(p_object_path, v_cur));
  end if;

  if v_cur.deleted_at is null then
    -- the current copy becomes the previous one; the old previous object goes
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
  return jsonb_build_object('status', 'ok', 'revision', v_row.revision,
    'obsolete', case when v_cur.deleted_at is null then private.save_obsolete(v_old_prev, v_row) else '[]'::jsonb end);
end;
$$;
revoke execute on function private.save_claim_impl(text, bigint, text, text, text, integer, integer, jsonb, text, timestamptz, boolean) from public, anon;
grant execute on function private.save_claim_impl(text, bigint, text, text, text, integer, integer, jsonb, text, timestamptz, boolean) to authenticated;

-- The object a write freed, as the `obsolete` list: empty when there is none or the row still points at it.
create or replace function private.save_obsolete(p_path text, p_row public.cloud_saves)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_path is null or p_path is not distinct from p_row.object_path or p_path is not distinct from p_row.prev_object_path
              then '[]'::jsonb else jsonb_build_array(p_path) end
$$;
revoke execute on function private.save_obsolete(text, public.cloud_saves) from public, anon;
grant execute on function private.save_obsolete(text, public.cloud_saves) to authenticated, service_role;

create or replace function private.save_delete_impl(p_slot text, p_base_revision bigint, p_device_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cur public.cloud_saves%rowtype;
  v_row public.cloud_saves%rowtype;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = 'PT401';
  end if;
  if (select private.is_anonymous()) then
    raise exception 'guest sessions do not keep cloud saves' using errcode = 'PT403';
  end if;
  if p_slot is null or p_slot not in ('quick', 'season', 'dynasty', 'h2h') then
    raise exception 'unknown save slot' using errcode = '22023';
  end if;
  if not private.take_rate_limit('cloud.claims', v_uid, 60, 3600) then
    raise exception 'too many cloud saves this hour' using errcode = 'PT429';
  end if;
  select * into v_cur from public.cloud_saves s where s.user_id = v_uid and s.slot = p_slot for update;
  if not found or v_cur.deleted_at is not null then
    return jsonb_build_object('status', 'unchanged', 'revision', coalesce(v_cur.revision, 0));
  end if;
  if v_cur.revision is distinct from p_base_revision then
    return jsonb_build_object('status', 'conflict', 'revision', v_cur.revision, 'gameId', v_cur.game_id,
      'contentHash', v_cur.content_hash, 'meta', v_cur.meta, 'deviceId', v_cur.device_id, 'updatedAt', v_cur.updated_at);
  end if;
  update public.cloud_saves s
     set prev_revision = v_cur.revision, prev_game_id = v_cur.game_id, prev_content_hash = v_cur.content_hash,
         prev_object_path = v_cur.object_path, prev_meta = v_cur.meta, prev_saved_at = v_cur.updated_at,
         revision = v_cur.revision + 1, object_path = null, bytes = null, raw_bytes = null,
         deleted_at = now(), device_id = coalesce(p_device_id, v_cur.device_id), updated_at = now()
   where s.user_id = v_uid and s.slot = p_slot
  returning * into v_row;
  return jsonb_build_object('status', 'ok', 'revision', v_row.revision, 'obsolete', private.save_obsolete(v_cur.prev_object_path, v_row));
end;
$$;
revoke execute on function private.save_delete_impl(text, bigint, text) from public, anon;
grant execute on function private.save_delete_impl(text, bigint, text) to authenticated;

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
    if v_cur.revision is distinct from p_base_revision then
      return jsonb_build_object('status', 'conflict', 'revision', v_cur.revision, 'data', v_cur.data);
    end if;
    update public.cloud_profile c
       set revision = c.revision + 1, data = p_data, device_id = p_device_id, updated_at = now()
     where c.user_id = v_uid
    returning c.revision into v_rev;
    return jsonb_build_object('status', 'ok', 'revision', v_rev);
  end if;
  if p_base_revision is distinct from 0 then
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

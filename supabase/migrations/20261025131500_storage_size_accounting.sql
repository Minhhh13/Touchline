-- migration: storage_size_accounting
-- TouchLine online layer, Phase 1: second adversarial review (2026-10-25). save_claim metered the hourly cloud byte
-- budget (`cloud.bytes`, 32 MB an hour) and filled cloud_saves.bytes from p_bytes, a number the client sends, so a
-- client could claim 8 MB uploads as 1 byte each and the budget never ran out. The claim now reads the size Storage
-- itself recorded for the object (storage.objects.metadata ->> 'size') and uses p_bytes only while that metadata is
-- not written yet. A forward migration: it replaces the function of review_hardening and changes nothing else.

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
  v_size bigint;
  v_bytes bigint;
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
  -- Storage records the size it stored (metadata.size); the caller's p_bytes is only a fallback for an object whose
  -- metadata is not written yet, so the hourly byte budget and the row's size are the real ones.
  select (o.metadata ->> 'size')::bigint into v_size
  from storage.objects o where o.bucket_id = 'saves' and o.name = p_object_path;
  if not found then
    raise exception 'upload the save before claiming it' using errcode = '22023';
  end if;
  v_bytes := coalesce(v_size, p_bytes);
  if v_bytes is null or v_bytes < 1 or v_bytes > 8388608 then
    raise exception 'the upload has no usable size' using errcode = '22023';
  end if;
  if not private.take_rate_limit('cloud.claims', v_uid, 60, 3600) then
    raise exception 'too many cloud saves this hour; the next one retries later' using errcode = 'PT429';
  end if;
  if not private.take_rate_limit('cloud.bytes', v_uid, 33554432, 3600, v_bytes) then
    raise exception 'too much cloud data this hour; the next save retries later' using errcode = 'PT429';
  end if;

  select * into v_cur from public.cloud_saves s where s.user_id = v_uid and s.slot = p_slot for update;
  if not found then
    if p_base_revision is distinct from 0 or coalesce(p_as_previous, false) then
      return jsonb_build_object('status', 'conflict', 'revision', 0);
    end if;
    insert into public.cloud_saves (user_id, slot, revision, game_id, content_hash, object_path, bytes, raw_bytes, meta, device_id, client_saved_at)
    values (v_uid, p_slot, 1, p_game_id, p_content_hash, p_object_path, v_bytes, p_raw_bytes, coalesce(p_meta, '{}'::jsonb), p_device_id, p_client_saved_at)
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
         bytes = v_bytes, raw_bytes = p_raw_bytes, meta = coalesce(p_meta, '{}'::jsonb), device_id = p_device_id,
         client_saved_at = p_client_saved_at, deleted_at = null, updated_at = now()
   where s.user_id = v_uid and s.slot = p_slot
  returning * into v_row;
  return jsonb_build_object('status', 'ok', 'revision', v_row.revision,
    'obsolete', case when v_cur.deleted_at is null then private.save_obsolete(v_old_prev, v_row) else '[]'::jsonb end);
end;
$$;
revoke execute on function private.save_claim_impl(text, bigint, text, text, text, integer, integer, jsonb, text, timestamptz, boolean) from public, anon;
grant execute on function private.save_claim_impl(text, bigint, text, text, text, integer, integer, jsonb, text, timestamptz, boolean) to authenticated;

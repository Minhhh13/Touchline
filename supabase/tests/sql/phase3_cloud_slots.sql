-- Cloud slots for arena runs and Run-ins (migration cloud_slots_arena_runin): the two new slots take uploads, claims,
-- a tombstone and a new game over it like the first four; unknown slots are still refused everywhere; the object cap
-- is still 16; "Delete my cloud data" returns every slot's objects. Runs in one transaction and rolls back.
\set ON_ERROR_STOP on
\pset pager off
begin;

insert into auth.users (id, email, is_anonymous) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'fay@example.com', false), ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'gus@example.com', false);

\echo '--- cloud slots: the table and the bucket take arena and runin, and nothing else new'
do $t$ begin
  assert exists (select 1 from pg_constraint where conrelid = 'public.cloud_saves'::regclass and conname = 'cloud_saves_slot_check'
                 and pg_get_constraintdef(oid) like '%arena%' and pg_get_constraintdef(oid) like '%runin%'), 'the slot check names the new slots';
  assert (select count(*) from pg_constraint where conrelid = 'public.cloud_saves'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ '\mslot\M') = 1, 'one slot check';
  perform test.act('authenticated', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  insert into storage.objects (bucket_id, name) values ('saves', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/arena/1000-aaaaaaaaaaaaaaaa.json.gz');
  insert into storage.objects (bucket_id, name) values ('saves', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/arena/1001-bbbbbbbbbbbbbbbb.json.gz');
  insert into storage.objects (bucket_id, name) values ('saves', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/runin/1000-cccccccccccccccc.json.gz');
  insert into storage.objects (bucket_id, name) values ('saves', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/quick/1000-dddddddddddddddd.json.gz');
  assert test.try($$insert into storage.objects (bucket_id, name) values ('saves', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/gauntlet/1-aaaaaaaaaaaaaaaa.json.gz')$$) like '42501%', 'unknown slot folder';
  assert test.try($$insert into storage.objects (bucket_id, name) values ('saves', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc/arena/1-aaaaaaaaaaaaaaaa.json.gz')$$) like '42501%', 'upload into another folder';
end $t$;

\echo '--- cloud slots: compare-and-set, previous copy, tombstone and a new game on the arena and runin slots'
do $t$ declare r jsonb; begin
  perform test.act('authenticated', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  r := public.save_claim('arena', 0, 'run1', repeat('1', 64), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/arena/1000-aaaaaaaaaaaaaaaa.json.gz', 100, 1000, '{"mode":"arena","arena":{"format":"cup","step":0,"over":false}}', 'device-ffff', now());
  assert r->>'status' = 'ok' and (r->>'revision')::int = 1, 'first arena claim ' || r;
  r := public.save_claim('arena', 0, 'run1', repeat('2', 64), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/arena/1001-bbbbbbbbbbbbbbbb.json.gz', 100, 1000, '{}', 'device-gggg', now());
  assert r->>'status' = 'conflict' and (r->>'revision')::int = 1, 'stale arena base ' || r;
  r := public.save_claim('arena', 1, 'run1', repeat('2', 64), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/arena/1001-bbbbbbbbbbbbbbbb.json.gz', 100, 1000, '{"mode":"arena","arena":{"format":"cup","step":1,"over":false}}', 'device-ffff', now());
  assert r->>'status' = 'ok' and (r->>'revision')::int = 2 and r->'obsolete' = '[]', 'second arena claim ' || r;
  assert (select prev_object_path like '%/arena/1000-%' and meta->'arena'->>'step' = '1' from public.cloud_saves where slot = 'arena'), 'previous copy and meta kept';
  r := public.save_claim('runin', 0, 'ri1', repeat('3', 64), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/runin/1000-cccccccccccccccc.json.gz', 100, 1000, '{"mode":"runin"}', 'device-ffff', now());
  assert r->>'status' = 'ok' and (r->>'revision')::int = 1, 'first run-in claim ' || r;
  assert test.try($$select public.save_claim('runin', 1, 'ri1', repeat('4', 64), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/arena/1001-bbbbbbbbbbbbbbbb.json.gz', 1, 1, '{}', 'device-ffff', now())$$) like '22023%', 'an arena object claimed for the runin slot';
  assert test.try($$select public.save_claim('gauntlet', 0, 'x', repeat('5', 64), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/quick/1000-dddddddddddddddd.json.gz', 1, 1, '{}', 'device-ffff', now())$$) like '22023%', 'unknown slot claim';
  assert test.try($$select public.save_delete('gauntlet', 0, 'device-ffff')$$) like '22023%', 'unknown slot delete';
  r := public.save_delete('runin', 1, 'device-ffff');
  assert r->>'status' = 'ok' and (r->>'revision')::int = 2, 'run-in tombstone ' || r;
  assert (select deleted_at is not null and object_path is null and game_id = 'ri1' and prev_object_path like '%/runin/1000-%' from public.cloud_saves where slot = 'runin'), 'tombstone keeps id and copy';
  insert into storage.objects (bucket_id, name) values ('saves', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/runin/1001-eeeeeeeeeeeeeeee.json.gz');
  r := public.save_claim('runin', 2, 'ri2', repeat('6', 64), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/runin/1001-eeeeeeeeeeeeeeee.json.gz', 100, 1000, '{}', 'device-ffff', now());
  assert r->>'status' = 'ok' and (r->>'revision')::int = 3, 'new run-in over a tombstone ' || r;
  r := public.save_claim('quick', 0, 'q1', repeat('7', 64), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/quick/1000-dddddddddddddddd.json.gz', 100, 1000, '{}', 'device-ffff', now());
  assert r->>'status' = 'ok', 'the first four slots still claim ' || r;
end $t$;

\echo '--- cloud slots: another account sees none of it; the object cap is still 16'
do $t$ declare i int; r text; begin
  perform test.act('authenticated', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  assert (select count(*) from public.cloud_saves) = 0, 'G sees F''s saves';
  for i in 1 .. 16 loop
    insert into storage.objects (bucket_id, name) values ('saves', format('cccccccc-cccc-4ccc-8ccc-cccccccccccc/%s/%s-0123456789abcdef.json.gz', case when i % 2 = 0 then 'arena' else 'runin' end, i));
  end loop;
  r := test.try($$insert into storage.objects (bucket_id, name) values ('saves', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc/arena/99-0123456789abcdef.json.gz')$$);
  assert r like '42501%', 'the 17th object is refused: ' || r;
end $t$;

\echo '--- cloud slots: "Delete my cloud data" returns the new slots'' objects too'
do $t$ declare r jsonb; begin
  perform test.act('authenticated', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  r := public.cloud_delete_all();
  assert r->'objects' @> '["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/arena/1001-bbbbbbbbbbbbbbbb.json.gz", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/arena/1000-aaaaaaaaaaaaaaaa.json.gz", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/runin/1001-eeeeeeeeeeeeeeee.json.gz", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/runin/1000-cccccccccccccccc.json.gz"]', 'every object ' || r;
  assert (select count(*) from public.cloud_saves) = 0, 'rows gone';
end $t$;

rollback;
\echo 'CLOUD SLOTS ASSERTIONS PASSED'

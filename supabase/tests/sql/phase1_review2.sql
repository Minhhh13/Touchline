-- Second adversarial review of Phase 1 (2026-10-25): what the first review's suite did not reach.
-- Runs on its own account, so it does not depend on what the other suites left behind.
\set ON_ERROR_STOP on
\pset pager off

insert into auth.users (id, email) values ('77777777-7777-4777-8777-777777777777', 'frank@example.com');

\echo '--- review 2: the hourly cloud byte budget meters the size Storage recorded, not the size the client claims'
-- Storage writes metadata.size itself; here the superuser plays Storage
insert into storage.objects (bucket_id, name, metadata)
select 'saves', '77777777-7777-4777-8777-777777777777/season/' || i || '-' || repeat(i::text, 16) || '.json.gz', jsonb_build_object('size', 8000000)
from generate_series(1, 5) i;
insert into storage.objects (bucket_id, name) values ('saves', '77777777-7777-4777-8777-777777777777/quick/9-9999999999999999.json.gz');
do $t$ declare r jsonb; begin
  perform test.act('authenticated', '77777777-7777-4777-8777-777777777777');
  -- four 8 MB uploads claimed as 1 byte each: the row keeps the real size
  for i in 1 .. 4 loop
    r := public.save_claim('season', i - 1, 'g' || i, repeat(i::text, 64), '77777777-7777-4777-8777-777777777777/season/' || i || '-' || repeat(i::text, 16) || '.json.gz', 1, 1, '{}', 'device-ffff', now());
    assert r ->> 'status' = 'ok', r::text;
  end loop;
  assert (select bytes from public.cloud_saves where slot = 'season') = 8000000, 'the row took the client''s byte count';
  -- the fifth passes 32 MB in the hour whatever p_bytes says
  assert test.try($$select public.save_claim('season', 4, 'g5', repeat('5', 64), '77777777-7777-4777-8777-777777777777/season/5-5555555555555555.json.gz', 1, 1, '{}', 'device-ffff', now())$$) like 'PT429%',
    'a fifth 8 MB claim inside the hour must hit the byte budget';
  -- an object whose metadata Storage has not written yet falls back to p_bytes, which must be a real size
  assert test.try($$select public.save_claim('quick', 0, 'q', repeat('9', 64), '77777777-7777-4777-8777-777777777777/quick/9-9999999999999999.json.gz', 0, 1, '{}', 'device-ffff', now())$$) like '22023%',
    'a claim with no size anywhere must be refused';
end $t$;

\echo 'REVIEW 2 ASSERTIONS PASSED'

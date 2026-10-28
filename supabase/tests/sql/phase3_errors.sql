-- Error reports (migration error_reports): nobody but service_role files them, nobody but the owner and service_role
-- reads them, a bad report is skipped, a repeat from one device on one day only counts, the hourly cap holds, the
-- owner's summary groups them and the prune deletes them 30 days after they were last seen. Runs in one transaction
-- and rolls back.
\set ON_ERROR_STOP on
\pset pager off
begin;

create function test.er(p_device text, p_message text default 'TypeError: x is undefined', p_kind text default 'error') returns jsonb language sql immutable as $$
  select jsonb_build_object('kind', p_kind, 'message', p_message, 'stack', 'render /assets/Draft-abc.js:1:200' || E'\n' || 'mount /assets/index-def.js:2:10',
    'build', '2026-10-27T00:00:00.000Z', 'engine', '6', 'screen', 'game', 'phase', 'draft', 'viewport', '390x844', 'ua', 'safari/ios',
    'device', p_device, 'count', 1, 'at', '2026-10-27T10:00:00.000Z')
$$;
grant execute on function test.er(text, text, text) to anon, authenticated, service_role;

\echo '--- errors: the client roles reach neither the table, the view nor the writer'
do $t$ begin
  assert not has_table_privilege('anon', 'private.error_reports', 'select,insert,update,delete'), 'anon touches the reports';
  assert not has_table_privilege('authenticated', 'private.error_reports', 'select,insert,update,delete'), 'authenticated touches the reports';
  assert not has_table_privilege('anon', 'private.error_report_summary', 'select'), 'anon reads the summary';
  assert not has_table_privilege('authenticated', 'private.error_report_summary', 'select'), 'authenticated reads the summary';
  assert has_table_privilege('service_role', 'private.error_report_summary', 'select'), 'service_role cannot read the summary';
  assert not has_function_privilege('anon', 'public.svc_error_report(jsonb)', 'execute'), 'anon files a report';
  assert not has_function_privilege('authenticated', 'public.svc_error_report(jsonb)', 'execute'), 'authenticated files a report';
  assert has_function_privilege('service_role', 'public.svc_error_report(jsonb)', 'execute'), 'service_role cannot file';
  assert not has_function_privilege('service_role', 'private.error_reports_prune()', 'execute'), 'the prune is the owner''s (cron) only';
  assert not has_function_privilege('anon', 'private.error_reports_prune()', 'execute'), 'anon can prune';
  assert not exists (select 1 from information_schema.columns where table_schema = 'private' and table_name = 'error_reports'
    and column_name in ('user_id', 'email', 'address', 'ip', 'user_agent', 'payload')), 'a report column could name a person';
end $t$;
do $t$ begin
  perform test.act('authenticated', '22222222-2222-4222-8222-222222222222');
  assert test.try($$select public.svc_error_report(jsonb_build_array(test.er('0f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f')))$$) like '42501%', 'a client files a report';
  assert test.try($$select * from private.error_reports$$) like '42501%', 'a client reads reports';
  assert test.try($$select * from private.error_report_summary$$) like '42501%', 'a client reads the summary';
end $t$;
reset role;
do $t$ begin
  perform test.act('anon', null);
  assert test.try($$select public.svc_error_report(jsonb_build_array(test.er('0f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f')))$$) like '42501%', 'anon files a report';
end $t$;
reset role;

\echo '--- errors: svc_error_report files good reports, skips bad ones and counts repeats'
do $t$ declare n integer; begin
  perform test.act('service_role', null);
  n := public.svc_error_report(jsonb_build_array(
    test.er('0f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f'),
    test.er('0f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f', 'RangeError: bad length', 'rejection'),
    test.er('not-a-uuid'),
    test.er('1f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f', '', 'error'),
    test.er('1f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f', 'x', 'warning')));
  assert n = 2, 'took ' || n || ' reports, not 2';
  n := public.svc_error_report(jsonb_build_array(test.er('0f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f'), test.er('1f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f')));
  assert n = 2, 'took ' || n || ' repeats, not 2';
  assert (select count(*) from private.error_reports) = 3, 'a repeat from the same device on the same day made a new row';
  assert (select count from private.error_reports where device_id = '0f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f' and kind = 'error') = 2, 'the repeat did not count';
  assert test.try($$select public.svc_error_report('[1, 2, 3, 4, 5, 6]'::jsonb)$$) like '22023%', 'six reports in one call';
  assert test.try($$select public.svc_error_report('{}'::jsonb)$$) like '22023%', 'a report that is not an array';
  -- A message longer than the cap is skipped, not truncated
  assert public.svc_error_report(jsonb_build_array(test.er('2f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f', repeat('x', 301)))) = 0, 'a 301-character message was filed';
  -- The device's clock is kept within two days of the server's
  perform public.svc_error_report(jsonb_build_array(test.er('3f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f') || '{"at":"1999-01-01T00:00:00Z"}'::jsonb));
  assert (select first_at > now() - interval '2 days 1 minute' from private.error_reports where device_id = '3f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f'), 'first_at took a clock from 1999';
end $t$;
reset role;

\echo '--- errors: the summary groups one error across devices'
do $t$ declare s record; begin
  perform test.act('service_role', null);
  select * into s from private.error_report_summary where kind = 'error' and message = 'TypeError: x is undefined';
  assert s.devices = 3 and s.occurrences = 4, format('devices %s, occurrences %s', s.devices, s.occurrences);
  assert s.first_frame = 'render /assets/Draft-abc.js:1:200', s.first_frame;
  assert s.screens = array['game/draft'] and s.browsers = array['safari/ios'] and s.engines = array['6'], 'summary arrays';
end $t$;
reset role;

\echo '--- errors: the hourly intake is capped'
do $t$ begin
  insert into private.error_reports (device_id, fingerprint, kind, message, build, engine, screen, phase, viewport, ua)
  select gen_random_uuid(), left(md5(i::text), 16), 'error', 'flood', 'b', '6', 'home', 'none', '1x1', 'other/other'
  from generate_series(1, private.error_reports_hourly_cap()) i;
  perform test.act('service_role', null);
  assert public.svc_error_report(jsonb_build_array(test.er('4f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f'))) = 0, 'a report went in past the hourly cap';
end $t$;
reset role;
delete from private.error_reports where message = 'flood';

\echo '--- errors: the prune deletes reports 30 days after they were last seen'
update private.error_reports set last_at = now() - interval '31 days' where device_id = '0f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f';
update private.error_reports set last_at = now() - interval '29 days' where device_id = '1f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f';
do $t$ declare n integer; begin
  n := private.error_reports_prune();
  assert n = 2, 'pruned ' || n || ', not 2';
  assert not exists (select 1 from private.error_reports where device_id = '0f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f'), 'a report last seen 31 days ago is still here';
  assert exists (select 1 from private.error_reports where device_id = '1f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f'), 'a report last seen 29 days ago was pruned';
end $t$;

rollback;
\echo 'ERROR REPORTS ASSERTIONS PASSED'

-- The account flow's live name check (migration display_name_check): signed-in accounts only, the table's own
-- rules, another account's name taken ignoring case, your own name free, look-alikes refused, rate limited.
-- Runs on its own accounts, so it does not depend on what the other suites left behind.
\set ON_ERROR_STOP on
\pset pager off

insert into auth.users (id, email, is_anonymous) values
  ('88888888-8888-4888-8888-888888888888', 'gina@example.com', false),
  ('99999999-9999-4999-8999-999999999999', 'hal@example.com', false),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, true);
insert into public.profiles (user_id, display_name) values ('88888888-8888-4888-8888-888888888888', 'Gina Tactics');

\echo '--- account: the live name check'
do $t$ declare r jsonb; begin
  perform test.act('anon', null);
  assert test.try($$select public.display_name_check('Anyone')$$) like '42501%', 'anon must not check names';
  reset role;
  perform test.act('authenticated', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
  assert test.try($$select public.display_name_check('Guest Name')$$) like 'PT403%', 'a guest session must not check names';
  reset role;
  perform test.act('authenticated', '99999999-9999-4999-8999-999999999999');
  r := public.display_name_check('  gina   TACTICS ');
  assert r ->> 'available' = 'false' and r ->> 'reason' = 'taken' and r ->> 'name' = 'gina TACTICS', 'another account''s name, ignoring case and spaces: ' || r::text;
  r := public.display_name_check('Hal 9000');
  assert r ->> 'available' = 'true', 'a free name: ' || r::text;
  assert public.display_name_check('Ga') ->> 'reason' = 'shape', 'too short';
  assert public.display_name_check(repeat('x', 25)) ->> 'reason' = 'shape', 'too long';
  assert public.display_name_check('Gina' || chr(8203) || ' Tactics') ->> 'reason' = 'shape', 'a zero-width look-alike';
  assert public.display_name_check('<b>Hal</b>') ->> 'reason' = 'shape', 'angle brackets';
  reset role;
  perform test.act('authenticated', '88888888-8888-4888-8888-888888888888');
  assert public.display_name_check('GINA tactics') ->> 'available' = 'true', 'your own name is yours';
  reset role;
  -- the private helper is not reachable over the Data API's schema, but even called directly it needs a signed-in caller
  perform test.act('anon', null);
  assert test.try($$select private.display_name_check_impl('Anyone')$$) like '42501%', 'anon must not call the helper';
  reset role;
end $t$;

\echo '--- account: the name check is rate limited per account'
do $t$ declare i int; begin
  perform test.act('authenticated', '99999999-9999-4999-8999-999999999999');
  -- six checks above, then 234 more: the limit of 240 is reached
  for i in 1 .. 234 loop perform public.display_name_check('Hal ' || i); end loop;
  assert test.try($$select public.display_name_check('Hal last')$$) like 'PT429%', 'the 241st check in an hour must be refused';
  reset role;
end $t$;

\echo 'ACCOUNT ASSERTIONS PASSED'

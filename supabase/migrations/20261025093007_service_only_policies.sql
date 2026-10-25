-- migration: service_only_policies
-- TouchLine online layer, Phase 1: the tables in `private` that only the service role touches get an explicit
-- deny-all policy for the client roles. RLS with no policy already refuses them (and private is never exposed),
-- so nothing changes in behaviour; the policy states the intent and answers the Security Advisor's
-- "RLS enabled, no policy" notice (lint 0008).
do $$
declare
  t text;
begin
  foreach t in array array['rate_limits', 'data_packs', 'daily_entries', 'daily_totals', 'weekly_entries'] loop
    if not exists (select 1 from pg_policies p where p.schemaname = 'private' and p.tablename = t and p.policyname = t || '_service_only') then
      execute format('create policy %I on private.%I as restrictive for all to anon, authenticated using (false) with check (false)', t || '_service_only', t);
    end if;
  end loop;
end
$$;

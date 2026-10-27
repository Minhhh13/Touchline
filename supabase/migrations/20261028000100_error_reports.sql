-- migration: error_reports
-- TouchLine online layer: error reports, with no third-party service (docs/ONLINE.md section 5f).
--
-- An online build reports its own uncaught errors, unhandled rejections, what the screen boundary caught and chunks
-- that did not load (src/online/errors.ts). The client sends them as a guest (the publishable key, never a JWT) to
-- the Edge Function's `errors.report`, which validates every field and size (`reportProblem` in
-- src/online/core/errorReport.ts) and files them here through svc_error_report, executable by service_role only.
-- Clients write nothing and read nothing (invariant 14).
--
-- A row holds the message and our own stack frames (both scrubbed of emails, tokens and URL queries, by the client
-- and checked again by the server), the build id, the engine, the screen and phase, the viewport, a browser and OS
-- family, and a random id the device made for error reports alone. Never an account id, an email, a token, an
-- address or any game data. The same error from the same device on the same UTC day is one row with a count.
--
-- Retention (mirrored by RETENTION.errorReportDays in src/online/core/retention.ts, pinned by retention.test.ts):
-- a row is deleted 30 days after it was last seen, by the pg_cron job touchline-error-reports (daily, 04:41 UTC).
-- The table's intake is capped (private.error_reports_hourly_cap rows an hour across every device), so a flood can
-- never fill the Free project. The owner reads the reports through private.error_report_summary (runbook in
-- docs/ONLINE.md section 7, "Read the error reports").
--
-- Same rules as every online migration: RLS on the table with a deny-all policy for the client roles, explicit
-- grants after revoking this project's default privileges, a pinned search_path on every function, the svc_* writer
-- for service_role only, and nothing new on the client roles' allowlist (supabase/tests/sql/phase1_security.sql).

-- ------------------------------------------------------------------- table

create table if not exists private.error_reports (
  id bigint generated always as identity primary key,
  -- The random id one device made for its error reports (never an account id, never the sync record's id)
  device_id uuid not null,
  -- The same error on one device: kind, message and first frame (private.error_fingerprint)
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{16}$'),
  day date not null default ((now() at time zone 'utc')::date),
  kind text not null check (kind in ('error', 'rejection', 'boundary', 'chunk')),
  message text not null check (char_length(message) between 1 and 300),
  stack text not null default '' check (char_length(stack) <= 1200),
  build text not null check (build ~ '^[0-9A-Za-z.:_-]{1,40}$'),
  engine text not null check (engine ~ '^[0-9A-Za-z._-]{1,16}$'),
  screen text not null check (screen ~ '^[a-z0-9_-]{1,24}$'),
  phase text not null check (phase ~ '^[a-z0-9_-]{1,24}$'),
  viewport text not null check (viewport ~ '^[0-9]{1,5}x[0-9]{1,5}$'),
  ua text not null check (ua ~ '^[a-z]{1,10}/[a-z]{1,10}$'),
  count integer not null default 1 check (count between 1 and 100000),
  -- When the device first saw it (its own clock, kept within two days of the server's) and when the server last took it
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  constraint error_reports_once_a_day unique (device_id, fingerprint, day)
);
comment on table private.error_reports is 'Client error reports: written only by svc_error_report (the Edge Function), read by the owner through private.error_report_summary; deleted 30 days after last seen.';
create index if not exists error_reports_last_at_idx on private.error_reports (last_at);
alter table private.error_reports enable row level security;
revoke all on private.error_reports from public, anon, authenticated;
grant select, insert, update, delete on private.error_reports to service_role;
drop policy if exists error_reports_service_only on private.error_reports;
create policy error_reports_service_only on private.error_reports as restrictive for all to anon, authenticated using (false) with check (false);

-- ------------------------------------------------------------------- helpers

-- How long a report is kept after it was last seen, and how many rows the table takes in an hour across every device.
create or replace function private.error_reports_keep()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '30 days'
$$;

create or replace function private.error_reports_hourly_cap()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 2000
$$;

create or replace function private.error_fingerprint(p_kind text, p_message text, p_stack text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(md5(p_kind || '|' || p_message || '|' || split_part(p_stack, E'\n', 1)), 16)
$$;
revoke execute on function private.error_reports_keep() from public, anon, authenticated;
revoke execute on function private.error_reports_hourly_cap() from public, anon, authenticated;
revoke execute on function private.error_fingerprint(text, text, text) from public, anon, authenticated;
grant execute on function private.error_reports_keep(), private.error_reports_hourly_cap(), private.error_fingerprint(text, text, text) to service_role;

-- ---------------------------------------------------- service-only writer

-- File up to five reports (the Edge Function's batch). A report whose fields break a check is skipped, not fatal; a
-- repeat of today's row from the same device adds to its count. Returns how many it took (0 once the hour is full).
create or replace function public.svc_error_report(p_reports jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r jsonb;
  v_taken integer := 0;
  v_recent integer;
  v_at timestamptz;
begin
  if p_reports is null or jsonb_typeof(p_reports) <> 'array' or jsonb_array_length(p_reports) > 5 then
    raise exception 'p_reports is an array of at most 5 reports' using errcode = '22023';
  end if;
  select count(*) into v_recent from private.error_reports x where x.last_at > now() - interval '1 hour';
  if v_recent >= private.error_reports_hourly_cap() then
    return 0;
  end if;
  for r in select value from jsonb_array_elements(p_reports) loop
    begin
      v_at := least(now(), greatest(now() - interval '2 days', (r ->> 'at')::timestamptz));
      insert into private.error_reports as e (device_id, fingerprint, kind, message, stack, build, engine, screen, phase, viewport, ua, count, first_at)
      values ((r ->> 'device')::uuid, private.error_fingerprint(r ->> 'kind', r ->> 'message', coalesce(r ->> 'stack', '')), r ->> 'kind', r ->> 'message',
        coalesce(r ->> 'stack', ''), r ->> 'build', r ->> 'engine', r ->> 'screen', r ->> 'phase', r ->> 'viewport', r ->> 'ua',
        least(1000, greatest(1, coalesce((r ->> 'count')::integer, 1))), coalesce(v_at, now()))
      on conflict (device_id, fingerprint, day) do update
        set count = least(100000, e.count + excluded.count), last_at = now();
      v_taken := v_taken + 1;
    exception when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format
      or datetime_field_overflow or numeric_value_out_of_range or string_data_right_truncation then
      -- the validator lets nothing like this through; a report that still breaks a check is skipped
      null;
    end;
  end loop;
  return v_taken;
end;
$$;
revoke execute on function public.svc_error_report(jsonb) from public, anon, authenticated;
grant execute on function public.svc_error_report(jsonb) to service_role;

-- ------------------------------------------------------------------- the owner's view

-- One line per distinct error (kind, message, first frame) over the 30 days kept: how many devices saw it and how
-- often, when, on which engines, builds, screens and browsers. Read-only, owner and service_role only (run it in the
-- SQL editor: docs/ONLINE.md section 7, "Read the error reports").
create or replace view private.error_report_summary with (security_invoker = true) as
  select
    e.fingerprint,
    e.kind,
    e.message,
    split_part(min(e.stack), E'\n', 1) as first_frame,
    count(distinct e.device_id) as devices,
    sum(e.count) as occurrences,
    min(e.first_at) as first_seen,
    max(e.last_at) as last_seen,
    array_agg(distinct e.engine order by e.engine) as engines,
    array_agg(distinct e.build order by e.build) as builds,
    array_agg(distinct e.screen || '/' || e.phase order by e.screen || '/' || e.phase) as screens,
    array_agg(distinct e.ua order by e.ua) as browsers
  from private.error_reports e
  group by e.fingerprint, e.kind, e.message;
revoke all on private.error_report_summary from public, anon, authenticated;
grant select on private.error_report_summary to service_role;

-- ------------------------------------------------------------------- prune

-- Delete every report last seen more than 30 days ago. Owner only (the cron job), like the rooms' sweep.
create or replace function private.error_reports_prune()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_purged integer;
begin
  delete from private.error_reports x where x.last_at < now() - private.error_reports_keep();
  get diagnostics v_purged = row_count;
  return v_purged;
end;
$$;
revoke execute on function private.error_reports_prune() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('touchline-error-reports', '41 4 * * *', $job$ select private.error_reports_prune(); $job$);
  else
    raise notice 'pg_cron is not available: touchline-error-reports not scheduled (prune by hand: docs/ONLINE.md section 7)';
  end if;
end
$$;

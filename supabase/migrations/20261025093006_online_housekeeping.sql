-- migration: online_housekeeping
-- TouchLine online layer, Phase 1, part 6 of 6: scheduled clean-up. Needs pg_cron (Dashboard > Integrations > Cron, or the
-- statement below). Nothing here is needed for correctness; without pg_cron the blocks skip with a notice.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') and not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension pg_cron with schema pg_catalog;
    exception when others then
      raise notice 'pg_cron not enabled (%): enable it in the dashboard and re-run this block', sqlerrm;
    end;
  end if;
end
$$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    -- daily at 03:17 UTC: spent rate-limit windows and expired challenge codes
    perform cron.schedule('touchline-housekeeping', '17 3 * * *', $job$
      delete from private.rate_limits where window_start < now() - interval '2 days';
      delete from public.challenges where expires_at < now();
    $job$);
  else
    raise notice 'pg_cron is not available: touchline-housekeeping not scheduled';
  end if;
end
$$;

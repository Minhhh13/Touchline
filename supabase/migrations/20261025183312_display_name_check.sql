-- migration: display_name_check
-- TouchLine online layer, the account flow: a live "is this name free?" check for the profile setup step, so a new
-- account is told before saving. profiles rows stay readable by their owner only; this answers one boolean about one
-- name and nothing else, for signed-in accounts only (never anon or guests), rate limited per account. The names it can
-- confirm are the ones public boards already show, so it reveals nothing a board does not.
-- Same rules as the table: 3 to 24 characters once spaces are collapsed and trimmed, no control characters, no < or >,
-- private.is_clean_name (no invisible, bidi or exotic space characters), unique ignoring case.

create or replace function private.display_name_check_impl(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), ' +', ' ', 'g'));
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = 'PT401';
  end if;
  if (select private.is_anonymous()) then
    raise exception 'guest sessions do not have a name on the boards' using errcode = 'PT403';
  end if;
  if not private.take_rate_limit('names.check', v_uid, 240, 3600) then
    raise exception 'too many name checks this hour' using errcode = 'PT429';
  end if;
  if char_length(v_name) < 3 or char_length(v_name) > 24 or v_name ~ '[[:cntrl:]]' or v_name ~ '[<>]'
     or not private.is_clean_name(v_name) then
    return jsonb_build_object('name', v_name, 'available', false, 'reason', 'shape');
  end if;
  if exists (select 1 from public.profiles p where lower(p.display_name) = lower(v_name) and p.user_id <> v_uid) then
    return jsonb_build_object('name', v_name, 'available', false, 'reason', 'taken');
  end if;
  return jsonb_build_object('name', v_name, 'available', true);
end;
$$;
revoke execute on function private.display_name_check_impl(text) from public, anon;
grant execute on function private.display_name_check_impl(text) to authenticated;

create or replace function public.display_name_check(p_name text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.display_name_check_impl(p_name)
$$;
-- the project's default privileges grant every new public function to anon and authenticated: start from nothing
revoke execute on function public.display_name_check(text) from public, anon;
grant execute on function public.display_name_check(text) to authenticated;

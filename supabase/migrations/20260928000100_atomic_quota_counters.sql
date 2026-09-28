-- Make the two rate limits actually hold under concurrency.
--
-- Both quotas used to be read-then-write from a server function: SELECT the
-- current count, compare it against the cap, then UPDATE count + 1. Two
-- requests that interleave between the read and the write both see the old
-- value and both write the same number, so the cap could be bypassed by
-- firing requests in parallel. These functions do the check and the increment
-- in a single statement instead.

-- PulseAssist credits.
--
-- Consumes one credit and returns how many are left, or -1 when the caller is
-- already at the cap (so the server function can reject without a second query).
-- The rolling window resets in the same statement as the increment, which also
-- fixes the stale "credits remaining" number the old code reported after a reset.
create or replace function public.consume_ai_credit(
  _user_id uuid,
  _daily_credits integer,
  _window_hours integer default 24
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _remaining integer;
begin
  update public.profiles p
  set
    -- Reset first if the window has elapsed, then count this request.
    ai_credits_used = case
      when p.ai_credits_reset_at < now() - make_interval(hours => _window_hours) then 1
      else p.ai_credits_used + 1
    end,
    ai_credits_reset_at = case
      when p.ai_credits_reset_at < now() - make_interval(hours => _window_hours) then now()
      else p.ai_credits_reset_at
    end
  where p.id = _user_id
    -- Only succeeds while there is headroom, or when the window has rolled over.
    and (
      p.ai_credits_reset_at < now() - make_interval(hours => _window_hours)
      or p.ai_credits_used < _daily_credits
    )
  returning _daily_credits - p.ai_credits_used into _remaining;

  if _remaining is null then
    return -1;
  end if;

  return greatest(_remaining, 0);
end;
$$;

revoke all on function public.consume_ai_credit(uuid, integer, integer) from public, anon;
grant execute on function public.consume_ai_credit(uuid, integer, integer) to service_role;

-- New-conversation quota.
--
-- Claims one of today's slots and returns true, or false when the caller has
-- already used them all. daily_request_counts is keyed on (user_id, day), so the
-- ON CONFLICT path is what makes this atomic.
create or replace function public.claim_conversation_slot(
  _user_id uuid,
  _daily_limit integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _claimed boolean;
begin
  insert into public.daily_request_counts as drc (user_id, day, count)
  values (_user_id, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update
    set count = drc.count + 1
    where drc.count < _daily_limit
  returning true into _claimed;

  return coalesce(_claimed, false);
end;
$$;

revoke all on function public.claim_conversation_slot(uuid, integer) from public, anon;
grant execute on function public.claim_conversation_slot(uuid, integer) to service_role;

-- Hand a credit back when the AI call that reserved it failed. Floors at zero so
-- a double refund can't hand out free credits.
create or replace function public.refund_ai_credit(_user_id uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.profiles
  set ai_credits_used = greatest(ai_credits_used - 1, 0)
  where id = _user_id;
$$;

revoke all on function public.refund_ai_credit(uuid) from public, anon;
grant execute on function public.refund_ai_credit(uuid) to service_role;

-- Stop members granting themselves verification, credits, or a subscription.
--
-- profiles only ever had one UPDATE policy — "users can update own profile",
-- USING (auth.uid() = id) — which covers the whole row. Any signed-in user could
-- therefore run
--
--   supabase.from('profiles').update({ verification_tier: 'gold' }).eq('id', <self>)
--
-- and award themselves a Gold badge, unlimited PulseAssist credits and the
-- ability to send pitches. RLS cannot express "these columns are off limits",
-- so the check lives in a trigger.
--
-- The same policy also meant admins could not write anyone else's row, so the
-- admin panel's "grant badge" button silently updated nothing while reporting
-- success. Both the trigger and the new admin policy below fix that: tier
-- changes now go through the review server function (service role) or an admin.

create or replace function public.guard_privileged_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() is null for the service role and for SQL run in the dashboard.
  -- Those callers are already trusted, so let them through.
  if auth.uid() is null then
    return new;
  end if;

  if public.has_role(auth.uid(), 'admin') then
    return new;
  end if;

  if new.verification_tier is distinct from old.verification_tier then
    raise exception 'verification_tier is set by verification review, not directly'
      using errcode = '42501';
  end if;

  if new.subscription_status is distinct from old.subscription_status then
    raise exception 'subscription_status is set by billing, not directly'
      using errcode = '42501';
  end if;

  if new.ai_credits_used is distinct from old.ai_credits_used
     or new.ai_credits_reset_at is distinct from old.ai_credits_reset_at then
    raise exception 'AI credit counters are managed by consume_ai_credit()'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged_columns on public.profiles;

create trigger profiles_guard_privileged_columns
  before update on public.profiles
  for each row
  execute function public.guard_privileged_profile_columns();

-- Let admins moderate other members' profiles (needed for the admin panel).
drop policy if exists "admins can update any profile" on public.profiles;

create policy "admins can update any profile" on public.profiles
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- New accounts should start on the free plan. subscription_status defaulted to
-- 'active', which made the PulseAssist credit cap unreachable for everybody.
-- Existing rows are deliberately left alone so current members keep the access
-- they already have; only signups from here on get 'free'.
alter table public.profiles
  alter column subscription_status set default 'free';

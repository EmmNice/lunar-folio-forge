-- Make the admin RLS policies actually evaluable by signed-in users.
--
-- 20260713041210 revoked EXECUTE on has_role(uuid, app_role) from anon and
-- authenticated, leaving it granted only to service_role. Its own comment says
-- "RLS-scoped policy checks need to invoke has_role directly" — but a policy
-- expression is executed with the privileges of the *querying* role, so every
-- policy that calls has_role() raises
--
--   42501: permission denied for function has_role
--
-- for a normal signed-in user. That broke, silently and in production:
--
--   * verification_requests — the admin read/update policies are on the table,
--     so ALL authenticated access failed, including a member inserting or
--     reading their OWN application. This is why listPendingApplications had to
--     be a service-role server function to work at all.
--   * reports — the "reporters and admins can view" policy failed for anyone
--     who was not the reporter.
--   * the reviewApplication / listPendingApplications server functions, which
--     call has_role through the caller's own token: the error surfaced as
--     data=null, which the handler read as "not an admin" and turned into
--     "Forbidden: Admin only." So admin review could never succeed.
--   * profiles — once 20260928000200 added an admin UPDATE policy, every
--     authenticated profile write started failing too: bio, avatar,
--     notification prefs, pitch_limit, and onboarding_completed.
--
-- Rather than granting has_role to authenticated — which would let any user
-- probe whether an arbitrary UUID is an admin — this adds a zero-argument,
-- self-scoped variant. is_admin() can only ever answer "am I an admin?", so it
-- discloses nothing about anybody else, and it is what the policies actually
-- need. has_role(uuid, app_role) stays service_role-only.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  )
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

-- Repoint every policy that used has_role() at the callable variant.

drop policy if exists "admins can update any profile" on public.profiles;
create policy "admins can update any profile" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins can read all verification requests" on public.verification_requests;
create policy "admins can read all verification requests"
  on public.verification_requests
  for select to authenticated
  using (public.is_admin());

drop policy if exists "admins can update verification requests" on public.verification_requests;
create policy "admins can update verification requests"
  on public.verification_requests
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "reporters and admins can view reports" on public.reports;
create policy "reporters and admins can view reports" on public.reports
  for select to authenticated
  using (auth.uid() = reporter_id or public.is_admin());

-- The guard trigger is SECURITY DEFINER, so its body may call has_role, but use
-- the same helper here so there is a single definition of "is an admin".
create or replace function public.guard_privileged_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() is null for the service role and for SQL run in the dashboard.
  if auth.uid() is null then
    return new;
  end if;

  if public.is_admin() then
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

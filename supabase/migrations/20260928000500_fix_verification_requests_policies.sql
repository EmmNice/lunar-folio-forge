-- Remove the last policy that still called has_role(), and reconcile drift.
--
-- The live project carried a SELECT policy on verification_requests that exists
-- in no migration file — it was created directly against the database:
--
--   "users can view own or admins view all verification requests"
--     using (auth.uid() = user_id
--            or has_role(auth.uid(), 'admin')
--            or has_role(auth.uid(), 'super_admin'))
--
-- Postgres ORs permissive policies together and evaluates them with the querying
-- role's privileges, so this single policy made *every* authenticated read of
-- verification_requests fail with 42501 (has_role is service_role-only) — even a
-- member reading their own application, and even though 20260928000300 had
-- already converted the other policies to is_admin(). One stray policy is enough
-- to poison the table.
--
-- Replaced with two policies that express the same intent without has_role: the
-- owner reads their own rows, admins read everything.

drop policy if exists "users can view own or admins view all verification requests"
  on public.verification_requests;

drop policy if exists "users can view own verification requests"
  on public.verification_requests;

create policy "users can view own verification requests"
  on public.verification_requests
  for select to authenticated
  using (auth.uid() = user_id);

-- The dropped policy treated super_admin as equivalent to admin. Nothing in the
-- application references that role and nobody currently holds it, but the enum
-- value exists live, so keep the behaviour rather than silently narrowing access.
-- Added here so a database built from migrations matches the live one.
alter type public.app_role add value if not exists 'super_admin';

-- Compares role::text so this file never has to mention the new enum label as a
-- literal, which avoids the "unsafe use of new value of enum type" error when the
-- value is added and used in the same transaction.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role::text in ('admin', 'super_admin')
  )
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- Stop publishing every member's private columns to the whole internet.
--
-- The only SELECT policy on profiles is `USING (true)` for anon + authenticated,
-- and `GRANT SELECT` was held on all 26 columns. RLS is row-level, not
-- column-level, so "viewable by everyone" meant literally every column. The
-- publishable key ships inside the JS bundle, so anyone could run
--
--   GET /rest/v1/profiles?select=*
--
-- and walk off with every member's date_of_birth, subscription_status, AI credit
-- counters, notification preferences, moderation state and verification
-- evidence. Date of birth is the serious one: it is collected for the 13+ age
-- check and is identity-theft-grade PII.
--
-- The app's own queries never asked for those columns, which is why this was
-- invisible from the UI. Column-level GRANTs are the fix -- they apply to the
-- REST API, not just to our code.

-- ---------------------------------------------------------------------------
-- 1. Public columns: what a profile page legitimately shows a visitor
-- ---------------------------------------------------------------------------

revoke select on public.profiles from anon, authenticated;

grant select (
  id,
  handle,
  display_name,
  avatar_url,
  bio,
  company_name,
  role_type,
  verification_tier,
  github_url,
  portfolio_url,
  startup_url,
  traction_url,
  availability_status,
  hide_from_search,
  dm_cloaking_enabled,
  pitch_limit,
  onboarding_completed,
  created_at,
  updated_at
) on public.profiles to anon, authenticated;

-- Deliberately NOT granted, and why:
--   date_of_birth        -- PII, collected only for the 13+ age check
--   subscription_status  -- billing state
--   ai_credits_used      -- internal quota counter
--   ai_credits_reset_at  -- internal quota counter
--   notification_prefs   -- personal settings
--   contract_url         -- verification evidence, for admin review only
--   account_status       -- moderation state; nobody needs to see who is banned
--
-- onboarding_completed stays public: it is not personal data, the route guard
-- reads it on every navigation, and hiding it would buy nothing.

-- ---------------------------------------------------------------------------
-- 2. Members still need their own private columns
-- ---------------------------------------------------------------------------
-- Column GRANTs are not row-aware, so there is no way to say "your own DOB but
-- not anyone else's" with grants alone. A SECURITY DEFINER function scoped to
-- auth.uid() gives exactly that, and it is the only way to read those columns
-- over REST as a normal member.

create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from public.profiles where id = auth.uid()
$$;

comment on function public.current_profile() is
  'The caller''s own complete profile row, including the columns that are not '
  'granted to `authenticated`. Returns nothing when unauthenticated.';

-- Must name anon/authenticated explicitly, not just PUBLIC: Supabase's default
-- privileges grant EXECUTE on new public functions straight to both roles, and
-- that direct grant is not removed by revoking from PUBLIC. Leaving `anon` with
-- EXECUTE here would hand every private column to unauthenticated callers --
-- the function returns nothing when auth.uid() is null, but relying on that is
-- one refactor away from a leak.
revoke all on function public.current_profile() from public, anon, authenticated;
grant execute on function public.current_profile() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Column-level UPDATE, so the grants agree with the guard trigger
-- ---------------------------------------------------------------------------
-- `authenticated` held table-wide UPDATE on all 26 columns, with
-- guard_privileged_profile_columns() as the only thing stopping a member writing
-- their own verification tier, billing state, AI counters or moderation status.
-- That trigger works, and it produces far better error messages than a privilege
-- error, so it stays -- but a single `drop trigger` should not be all that stands
-- between a member and a Gold badge. Narrowing the grant makes the privilege
-- system agree with the trigger instead of deferring to it.

revoke update on public.profiles from authenticated;

grant update (
  -- Profile editor
  display_name,
  bio,
  avatar_url,
  company_name,
  role_type,
  github_url,
  portfolio_url,
  startup_url,
  traction_url,
  availability_status,
  -- Onboarding (handle is additionally locked after onboarding by the trigger)
  handle,
  date_of_birth,
  onboarding_completed,
  -- Settings screens
  notification_prefs,
  pitch_limit,
  dm_cloaking_enabled,
  hide_from_search,
  -- Verification application evidence
  contract_url,
  -- Maintained by the touch_updated_at trigger, but listed so an explicit write
  -- from the client is not a privilege error.
  updated_at
) on public.profiles to authenticated;

-- Deliberately NOT updatable by `authenticated`:
--   verification_tier    -- set by verification review
--   subscription_status  -- set by billing
--   ai_credits_used      -- set by consume_ai_credit()
--   ai_credits_reset_at  -- set by consume_ai_credit()
--   account_status       -- set by moderation
-- Admins change these through server functions using the service role, which is
-- not subject to these grants.

-- Same treatment for INSERT. In practice the row is always created by the
-- on_auth_user_created trigger (SECURITY DEFINER, so unaffected by this), which
-- makes a member's own INSERT a primary-key conflict and the
-- `users can insert own profile` policy close to unreachable. "Close to" is doing
-- a lot of work in that sentence for a path that could hand out a Gold badge, so
-- the same columns are excluded here.
revoke insert on public.profiles from authenticated;

grant insert (
  id,
  handle,
  display_name,
  bio,
  avatar_url,
  company_name,
  role_type,
  github_url,
  portfolio_url,
  startup_url,
  traction_url,
  availability_status,
  date_of_birth,
  onboarding_completed,
  notification_prefs,
  pitch_limit,
  dm_cloaking_enabled,
  hide_from_search,
  contract_url,
  created_at,
  updated_at
) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- A NOTE FOR ANYONE TOUCHING profiles QUERIES AFTER THIS
-- ---------------------------------------------------------------------------
-- Without table-wide SELECT, Postgres rejects `RETURNING *` on profiles with
-- "permission denied for table profiles" -- note *table*, not *column*, which
-- makes it look like a missing UPDATE grant when it is really the RETURNING.
--
-- PostgREST emits `RETURNING *` whenever the request carries
-- `Prefer: return=representation`, which supabase-js adds as soon as you chain
-- `.select()` with no argument onto an insert/update/delete. So:
--
--   .update({ bio }).eq("id", uid)                  -- fine (return=minimal)
--   .update({ bio }).eq("id", uid).select()         -- 42501
--   .update({ bio }).eq("id", uid).select("id,bio") -- fine
--
-- Name the columns. Every write path in the app today either returns nothing or
-- names its columns; this comment exists so the next one does too.

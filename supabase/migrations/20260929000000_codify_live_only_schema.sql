-- Codify schema that only ever existed in the live database.
--
-- Auditing production against this repo turned up objects that no migration
-- creates: profiles.account_status (plus its CHECK), profiles.availability_status,
-- profiles.contract_url, a second privileged-column guard trigger, and the
-- account_status-aware INSERT policies on posts and comments (live names them
-- "active users can create posts" / "active users can comment"; the repo only
-- ever created "authenticated users can ..."). They were almost certainly applied
-- straight to the database by hand or by a builder tool.
--
-- The practical consequence: a fresh `supabase db reset`, a new staging project,
-- or any disaster recovery from this repo produced a database WITHOUT the
-- moderation column, without its guard, and with post/comment INSERT policies
-- that let suspended accounts publish. This file makes the repo the source of
-- truth again. Every statement is idempotent so it is a no-op against the
-- already-drifted production database.

-- ---------------------------------------------------------------------------
-- 1. Columns that only existed live
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists account_status text not null default 'active',
  add column if not exists availability_status text,
  add column if not exists contract_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'account_status_valid') then
    alter table public.profiles add constraint account_status_valid
      check (account_status in ('active', 'restricted', 'banned'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'availability_status_valid') then
    alter table public.profiles add constraint availability_status_valid
      check (
        availability_status is null
        or availability_status in (
          'open_to_angel', 'raising_capital', 'seeking_cofounder', 'building_stealth'
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'contract_url_len') then
    alter table public.profiles add constraint contract_url_len
      check (contract_url is null or char_length(contract_url) <= 300);
  end if;
end $$;

comment on column public.profiles.account_status is
  'Moderation state. active = full access; restricted = read-only (cannot post, '
  'comment, like, repost or message); banned = read-only and content hidden from '
  'everyone but the author and admins. Only admins can change this.';

-- ---------------------------------------------------------------------------
-- 2. One privileged-column guard, not two
-- ---------------------------------------------------------------------------
-- Production carried two BEFORE UPDATE triggers doing overlapping jobs:
--   profiles_guard_privileged         -> guard_privileged_profile_columns()
--   profiles_guard_privileged_columns -> guard_profile_privileged_columns()
-- The second one exists nowhere in this repo. Two triggers firing in name order
-- on the same event is a maintenance trap: whichever raises first wins and the
-- other's rules are invisible. Fold both rule sets into the one the repo owns.

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

  -- Folded in from the live-only guard. Without this a suspended member could
  -- simply PATCH their own row back to 'active' and carry on posting.
  if new.account_status is distinct from old.account_status then
    raise exception 'account_status is set by moderation, not directly'
      using errcode = '42501';
  end if;

  -- The handle is the member's permanent address: /u/<handle> links and DM/pitch
  -- history all point at it. Onboarding still has to write it once (the row is
  -- created by handle_new_user() with a generated handle, then claimed on the
  -- onboarding form), so the lock starts the moment onboarding is finished --
  -- which is also the point at which the edit form stops offering the field.
  if new.handle is distinct from old.handle and old.onboarding_completed then
    raise exception 'handle cannot be changed after onboarding'
      using errcode = '42501';
  end if;

  -- ...and onboarding cannot be reopened to get around the line above.
  if old.onboarding_completed and not new.onboarding_completed then
    raise exception 'onboarding cannot be reopened'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Both triggers go before the redundant function can be dropped. Worth noting
-- how tangled this got: in production the names are crossed over, with
--   profiles_guard_privileged         -> guard_profile_privileged_columns()
--   profiles_guard_privileged_columns -> guard_privileged_profile_columns()
-- i.e. each trigger runs the function whose name matches the *other* trigger.
-- Dropping by name in the obvious pairing fails with 2BP01. Drop both first.
drop trigger if exists profiles_guard_privileged on public.profiles;
drop trigger if exists profiles_guard_privileged_columns on public.profiles;

drop function if exists public.guard_profile_privileged_columns();

create trigger profiles_guard_privileged
  before update on public.profiles
  for each row execute function public.guard_privileged_profile_columns();

-- ---------------------------------------------------------------------------
-- 3. Helpers used by policies
-- ---------------------------------------------------------------------------
-- These are SECURITY DEFINER on purpose. Section 4 of the next migration takes
-- column-level SELECT on profiles.account_status away from `authenticated`, and
-- a policy expression that reads a column the caller cannot see fails with
-- 42501. Wrapping the lookup in a definer function keeps the policies working
-- while the column itself stays private.

create or replace function public.actor_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and account_status = 'active'
  )
$$;

comment on function public.actor_is_active() is
  'True when the calling member may still create content. Used by the INSERT '
  'policies on posts, comments, likes, reposts and messages.';

-- `revoke ... from public` is not enough on hosted Supabase: ALTER DEFAULT
-- PRIVILEGES grants EXECUTE on every new public function directly to `anon` and
-- `authenticated`, and a direct grant survives a revoke aimed at PUBLIC. Name
-- both roles explicitly, then grant back only what is wanted.
revoke all on function public.actor_is_active() from public, anon, authenticated;
grant execute on function public.actor_is_active() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Write policies that respect moderation state
-- ---------------------------------------------------------------------------
-- posts and comments already had account_status-aware policies live; likes,
-- reposts and messages did not, so a banned account could still like, re-ship
-- and send DMs. Same rule everywhere now, expressed through actor_is_active().

drop policy if exists "authenticated users can create posts" on public.posts;
drop policy if exists "active users can create posts" on public.posts;
create policy "active users can create posts" on public.posts
  for insert to authenticated
  with check (auth.uid() = author_id and public.actor_is_active());

drop policy if exists "authenticated users can comment" on public.comments;
drop policy if exists "active users can comment" on public.comments;
create policy "active users can comment" on public.comments
  for insert to authenticated
  with check (auth.uid() = author_id and public.actor_is_active());

drop policy if exists "users can like posts" on public.likes;
drop policy if exists "active users can like posts" on public.likes;
create policy "active users can like posts" on public.likes
  for insert to authenticated
  with check (auth.uid() = user_id and public.actor_is_active());

drop policy if exists "users can repost" on public.reposts;
drop policy if exists "active users can repost" on public.reposts;
create policy "active users can repost" on public.reposts
  for insert to authenticated
  with check (auth.uid() = user_id and public.actor_is_active());

drop policy if exists "participants can send messages" on public.messages;
create policy "participants can send messages" on public.messages
  for insert to authenticated
  with check (
    auth.uid() = sender_id
    and public.actor_is_active()
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (auth.uid() = c.user_a or auth.uid() = c.user_b)
    )
  );

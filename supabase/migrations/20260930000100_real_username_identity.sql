-- Usernames become a real, chosen identifier instead of a slice of the email.
--
-- What was wrong, demonstrably. handle_new_user() built the handle from the email
-- local part — `split_part(new.email, '@', 1)` — and fell back to the same value
-- for display_name. The live consequence, straight out of production:
--
--     handle      display_name   email local part
--     itzemmyn    itzemmyn       itzemmyn
--
-- That member never chose either value. Their public display name is the front
-- half of their email address, which is both an identity failure and a quiet
-- disclosure: anyone reading the feed learns a chunk of their email, and for a
-- `firstname.lastname@company.com` signup it would have published their full name
-- and employer on a profile they thought was pseudonymous.
--
-- Signup also never asked for a username at all, so the generated one was the only
-- one most accounts would ever have — and `handle` was permanently frozen the
-- moment onboarding finished, with no UI anywhere to change it.
--
-- Four changes here:
--   1. A username is chosen at signup and carried through in user metadata.
--   2. Nothing is ever derived from the email — not the handle, not the name.
--   3. username_available() so the client can check before submitting, with the
--      unique index still the real arbiter.
--   4. The handle stops being permanent: it can be changed, once per 30 days.

-- ---------------------------------------------------------------------------
-- 1. What makes a username valid
-- ---------------------------------------------------------------------------
-- The `handle_format` CHECK on profiles is already `^[a-z0-9_]{2,20}$`. That
-- lowercase-only pattern is what makes uniqueness case-insensitive: `Godson` and
-- `GODSON` cannot be stored at all, so they cannot become separate accounts
-- alongside `godson`. This function is the same rule, callable from the client so
-- the form can explain a rejection instead of surfacing a constraint violation.

create or replace function public.username_is_valid(_username text)
returns boolean
language sql
immutable
as $$
  select _username is not null and _username ~ '^[a-z0-9_]{2,20}$'
$$;

comment on function public.username_is_valid(text) is
  'Mirrors the handle_format CHECK. Lowercase-only, which is what makes handle '
  'uniqueness case-insensitive without a separate lower() index.';

/*
 * Names nobody gets to register.
 *
 * Impersonation, mostly: an account called `admin` or `support` can ask other
 * members for credentials and be believed. `theledger` and `ledger` are reserved
 * for the same reason. The rest are words that appear in URLs and would make a
 * profile link ambiguous to read even though /u/<handle> means there is no actual
 * route collision.
 *
 * Deliberately a function rather than a table: this list changes about once a
 * year, and a table would need its own RLS, grants and admin surface to manage
 * something that is really part of the schema.
 */
create or replace function public.username_is_reserved(_username text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(_username, '')) = any (array[
    'admin', 'administrator', 'root', 'superuser', 'support', 'help', 'helpdesk',
    'staff', 'team', 'moderator', 'mod', 'security', 'billing', 'payments',
    'theledger', 'ledger', 'official', 'verified', 'system', 'noreply', 'no_reply',
    'api', 'www', 'app', 'auth', 'login', 'signup', 'settings', 'account',
    'notifications', 'messages', 'search', 'explore', 'feed', 'studio', 'pulse',
    'me', 'you', 'null', 'undefined', 'anonymous', 'deleted'
  ])
$$;

comment on function public.username_is_reserved(text) is
  'Blocks impersonation-prone and URL-ambiguous usernames. Enforced by the '
  'enforce_handle_rules trigger, not only by the availability check.';

-- ---------------------------------------------------------------------------
-- 2. Availability, for the signup form
-- ---------------------------------------------------------------------------
/*
 * One boolean, and the reason when it is false.
 *
 * SECURITY DEFINER so it works for `anon` — the person checking has not signed up
 * yet — and so it is unaffected by the column grants on profiles. It returns only
 * a verdict, never a row.
 *
 * This is a courtesy, not a guarantee. Two people can pass the check with the same
 * name microseconds apart; the unique index is what actually decides, and
 * handle_new_user() raises cleanly when it loses that race. Treating an
 * availability check as a reservation is the classic way to end up with duplicates.
 */
create or replace function public.username_available(_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _u text := lower(trim(coalesce(_username, '')));
begin
  if not public.username_is_valid(_u) then
    return jsonb_build_object(
      'available', false,
      'reason', 'invalid',
      'message', '2-20 characters, using lowercase letters, numbers or underscores.'
    );
  end if;

  if public.username_is_reserved(_u) then
    return jsonb_build_object(
      'available', false,
      'reason', 'reserved',
      'message', 'That username is reserved.'
    );
  end if;

  -- Case-insensitive by construction: stored handles are always lowercase.
  if exists (select 1 from public.profiles where handle = _u) then
    return jsonb_build_object(
      'available', false,
      'reason', 'taken',
      'message', 'That username is already taken.'
    );
  end if;

  return jsonb_build_object('available', true, 'reason', 'ok', 'message', 'Available');
end;
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

comment on function public.username_available(text) is
  'Signup-time availability check. Returns {available, reason, message}. Callable '
  'by anon. Advisory only — the unique index on profiles.handle is the arbiter.';

-- ---------------------------------------------------------------------------
-- 3. Handle rules enforced on every write
-- ---------------------------------------------------------------------------
-- The format CHECK covers shape. This covers the reserved list, and normalises
-- case and whitespace so a client that forgets to lowercase gets a working signup
-- rather than a constraint error it has to interpret.

create or replace function public.enforce_handle_rules()
returns trigger
language plpgsql
as $$
begin
  if new.handle is null then
    return new;
  end if;

  -- Normalise first, so the checks below and the stored value agree.
  new.handle := lower(trim(new.handle));

  if not public.username_is_valid(new.handle) then
    raise exception 'username must be 2-20 characters of a-z, 0-9 or underscore'
      using errcode = '23514';
  end if;

  -- Only on a change, so the reserved list can grow later without freezing
  -- existing accounts out of every future profile edit.
  if tg_op = 'INSERT' or new.handle is distinct from old.handle then
    if public.username_is_reserved(new.handle) then
      raise exception 'that username is reserved'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_handle_rules() from public, anon, authenticated;

drop trigger if exists profiles_enforce_handle on public.profiles;
create trigger profiles_enforce_handle
  before insert or update of handle on public.profiles
  for each row execute function public.enforce_handle_rules();

-- ---------------------------------------------------------------------------
-- 4. A username can be changed again
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists handle_changed_at timestamptz;

comment on column public.profiles.handle_changed_at is
  'When the handle was last changed after onboarding. Null means never. Stamped by '
  'guard_privileged_profile_columns, never by the client, and used to enforce the '
  '30-day cooldown.';

-- ---------------------------------------------------------------------------
-- 5. New accounts: username from metadata, nothing from the email
-- ---------------------------------------------------------------------------
/*
 * Two paths in, and neither touches the email address.
 *
 * Email signup supplies `username` in raw_user_meta_data. If it is missing,
 * malformed, reserved or taken, this RAISES — which rolls the auth.users insert
 * back with it, because the trigger runs in that transaction. That is the
 * behaviour we want: no account exists in a half-named state, and the person is
 * told to pick another name. The alternative most implementations choose — quietly
 * appending a digit — hands someone an identity they did not ask for and will be
 * stuck with.
 *
 * OAuth has no username to offer at the point the account is created. Those get a
 * neutral placeholder (`dev_` + 8 hex) and onboarding requires them to choose,
 * exactly as before — but the placeholder is random rather than their email, so
 * nothing is disclosed if they abandon onboarding. The loop bound is a safety net;
 * a collision on 32 bits of randomness is not something to plan around.
 *
 * display_name falls back to the username, never to the email local part.
 */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested  text;
  final_handle text;
  raw_name   text;
  raw_avatar text;
  attempt    int := 0;
begin
  requested := lower(trim(coalesce(new.raw_user_meta_data->>'username', '')));

  if requested <> '' then
    -- Chosen at signup. Validate loudly rather than silently altering it.
    if not public.username_is_valid(requested) then
      raise exception 'username must be 2-20 characters of a-z, 0-9 or underscore'
        using errcode = '23514';
    end if;
    if public.username_is_reserved(requested) then
      raise exception 'that username is reserved'
        using errcode = '23514';
    end if;
    if exists (select 1 from public.profiles where handle = requested) then
      raise exception 'username already taken'
        using errcode = '23505';
    end if;
    final_handle := requested;
  else
    -- OAuth, or any provider that cannot ask. Neutral, not email-derived.
    loop
      -- gen_random_uuid() is core Postgres; gen_random_bytes would pull in pgcrypto
      -- and make this migration fail on a plain cluster.
      final_handle := 'dev_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      exit when not exists (select 1 from public.profiles where handle = final_handle);
      attempt := attempt + 1;
      if attempt > 10 then
        raise exception 'could not allocate a username' using errcode = '23505';
      end if;
    end loop;
  end if;

  raw_name := nullif(trim(coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    ''
  )), '');

  raw_avatar := coalesce(
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'picture'
  );

  insert into public.profiles (id, handle, display_name, avatar_url)
  values (new.id, final_handle, coalesce(raw_name, final_handle), raw_avatar);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The privileged-column guard, with the handle lock replaced by a cooldown
-- ---------------------------------------------------------------------------
-- Reproduced in full because CREATE OR REPLACE needs the whole body; every other
-- rule is byte-identical to what was live. Only the handle branch changed.

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

  /*
    The handle used to be frozen forever once onboarding finished. That was
    defensible when the handle was the member's permanent address, and indefensible
    once you notice most handles were generated from an email address nobody was
    asked about — it made a bad identity permanent.
    Changeable now, with a cooldown, which is what GitHub and X both settle on:
    frequent enough to fix a mistake or a rename, slow enough that a handle cannot
    be cycled to dodge a block or to squat names.
  */
  if new.handle is distinct from old.handle then
    if old.onboarding_completed then
      if old.handle_changed_at is not null
         and old.handle_changed_at > now() - interval '30 days' then
        raise exception 'username can only be changed once every 30 days'
          using errcode = '42501';
      end if;
      -- Stamped here, not by the client, so the cooldown cannot be reset by hand.
      new.handle_changed_at := now();
    else
      -- Still onboarding: choosing a name is free and does not start the clock.
      new.handle_changed_at := old.handle_changed_at;
    end if;
  else
    new.handle_changed_at := old.handle_changed_at;
  end if;

  -- ...and onboarding cannot be reopened to get a free rename.
  if old.onboarding_completed and not new.onboarding_completed then
    raise exception 'onboarding cannot be reopened'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_privileged_profile_columns() from public, anon, authenticated;

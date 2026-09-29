-- Takes back privileges that were never meant to be handed to members.
--
-- The thirteen tables from the original scaffold were created with a blanket
-- `grant all on <table> to anon, authenticated`. "All" is wider than it reads:
-- alongside SELECT/INSERT/UPDATE/DELETE it includes TRUNCATE, TRIGGER and
-- REFERENCES. Every migration since has used explicit column grants, so the
-- newer tables (follows, blocks, mutes, bookmarks, profile_projects, billing_*)
-- are clean — this is the scaffold's inheritance, still in place.
--
-- TRUNCATE is the one that matters, because **TRUNCATE is not subject to row
-- level security**. RLS is what makes every other privilege on this list
-- harmless: a member holds UPDATE on verification_requests, but the only UPDATE
-- policy requires is_admin(), so their statement matches no rows. TRUNCATE has
-- no such filter. It is checked against the table grant and nothing else.
--
-- Demonstrated on production before writing this, inside a transaction that was
-- rolled back:
--
--     begin;
--     set local role authenticated;
--     truncate table public.notifications;   -- succeeded
--     select count(*) from public.notifications;  -- 0, was 2
--     rollback;
--
-- The same statement would have emptied posts, profiles, messages, or
-- user_roles — that last one being where admin membership is recorded.
--
-- How reachable is it? Not, today, through the front door: PostgREST exposes
-- SELECT/INSERT/UPDATE/DELETE and RPC, and offers no way to spell TRUNCATE. It
-- needs a second flaw to become an incident — a SQL-injectable definer function,
-- a future SQL-over-HTTP feature, a leaked pooler credential that maps to
-- `authenticated`. That is precisely the argument for revoking it: the database
-- should not be one unrelated mistake away from a member being able to delete
-- the platform. The same reasoning already applied to narrowing UPDATE on
-- profiles in 20260929000100, where the guard trigger worked and the grant was
-- narrowed anyway.
--
-- Nothing here touches `service_role`, which is how the server does its work.

-- ---------------------------------------------------------------------------
-- 1. TRUNCATE, TRIGGER and REFERENCES: never appropriate for a member
-- ---------------------------------------------------------------------------
-- TRUNCATE  — bypasses RLS, as above.
-- TRIGGER   — lets a role attach a trigger to a table. `authenticated` cannot
--             CREATE in schema public (verified: has_schema_privilege = false),
--             so it cannot supply a trigger *function* today, which is the only
--             reason this is not also critical.
-- REFERENCES— lets a role point a foreign key at the table, which can be used to
--             probe for the existence of rows RLS would otherwise hide.
--
-- Applied across every table in the schema rather than the known thirteen, so a
-- table added later with a careless `grant all` is corrected by re-running this.
do $$
declare
  _table text;
begin
  for _table in
    select tablename from pg_tables where schemaname = 'public' order by tablename
  loop
    execute format(
      'revoke truncate, trigger, references on public.%I from anon, authenticated',
      _table
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. DELETE where deleting was never part of the design
-- ---------------------------------------------------------------------------
/*
 * These nine have DELETE granted to `authenticated` and no DELETE policy at all,
 * so RLS already reduces every attempt to zero rows. The grant is doing nothing
 * except describing a capability the product does not have.
 *
 * Listed explicitly rather than derived from pg_policies at apply time: a
 * migration whose effect depends on which policies happen to exist when it runs
 * is not reviewable, and cannot be reasoned about from the file. Adding a DELETE
 * policy later now requires adding the matching grant, which is the right way
 * round — a policy without a grant is a feature that silently does nothing.
 *
 * Deliberately NOT revoked, because the product does delete these from the
 * browser under a policy: posts, comments, likes, reposts, bookmarks, follows,
 * mutes, blocks.
 *
 * Account deletion still works: it runs as the service role through
 * auth.admin.deleteUser() (account.functions.ts), and the profile row goes with
 * the auth user by cascade.
 */
revoke delete on public.conversations        from authenticated;
revoke delete on public.daily_request_counts from authenticated;
revoke delete on public.messages             from authenticated;
revoke delete on public.notifications        from authenticated;
revoke delete on public.pitches              from authenticated;
revoke delete on public.profiles             from authenticated;
revoke delete on public.reports              from authenticated;
revoke delete on public.user_roles           from authenticated;
revoke delete on public.verification_requests from authenticated;

-- ---------------------------------------------------------------------------
-- 2b. UPDATE on verification_requests
-- ---------------------------------------------------------------------------
/*
 * Members hold table-wide UPDATE here, which includes proof_verified_at — the
 * column that decides whether an application counts as proven. RLS is the only
 * thing stopping them: the sole UPDATE policy requires is_admin(), so a member's
 * statement matches no rows. That is too thin a margin for the column that the
 * entire anti-fraud mechanism rests on.
 *
 * Nothing in the product needs it. An application is inserted by its owner and
 * never edited by them; every write afterwards — review decisions, proof results —
 * happens in a server function with the service role.
 *
 * The admin UPDATE policy goes with the grant, because a policy nobody has the
 * privilege to exercise is exactly the kind of thing that reads as a working
 * safeguard and is not. Routing admin writes exclusively through the server
 * function is also what guarantees they land in admin_actions: a direct client
 * update would have changed a verification tier with no audit row behind it.
 */
revoke update on public.verification_requests from authenticated;
drop policy if exists "admins can update verification requests" on public.verification_requests;

-- ---------------------------------------------------------------------------
-- 3. anon SELECT on tables anon has no business reading
-- ---------------------------------------------------------------------------
/*
 * Eight tables grant SELECT to `anon` while having no policy an anonymous caller
 * can satisfy — every one of their SELECT policies tests auth.uid(). So the reads
 * already come back empty, and the grant only widens what a future policy change
 * could accidentally expose.
 *
 * `profiles`, `posts`, `comments`, `likes` and `reposts` keep anon SELECT on
 * purpose: signed-out visitors read the feed and profiles, which is the whole
 * reason a public timeline exists.
 */
revoke select on public.conversations         from anon;
revoke select on public.daily_request_counts  from anon;
revoke select on public.messages              from anon;
revoke select on public.notifications         from anon;
revoke select on public.pitches               from anon;
revoke select on public.reports               from anon;
revoke select on public.user_roles            from anon;
revoke select on public.verification_requests from anon;

-- ---------------------------------------------------------------------------
-- 4. Stop the next table inheriting the same thing
-- ---------------------------------------------------------------------------
/*
 * Supabase ships default privileges that grant new tables in `public` straight to
 * anon and authenticated. That default is what produced this whole file, and it
 * will produce it again for the next table created outside a migration that
 * remembers to be careful.
 *
 * Narrowed rather than removed: the defaults are altered for the roles that own
 * objects here so that new tables arrive without TRUNCATE/TRIGGER/REFERENCES.
 * SELECT/INSERT/UPDATE/DELETE are left alone, because removing those would break
 * the assumption every existing migration was written against and turn a missing
 * grant into a runtime error long after the fact.
 */
-- Per-role and individually fault-tolerant: a migration runs as `postgres`, which
-- may alter its own default privileges but not those of `supabase_admin` (that
-- raises 42501). Skipping what we cannot change beats failing the whole migration
-- and leaving the revokes above unapplied — which is exactly what happened on the
-- first attempt at this.
do $$
declare
  _owner text;
begin
  foreach _owner in array array['postgres', 'supabase_admin']
  loop
    begin
      execute format(
        'alter default privileges for role %I in schema public '
        'revoke truncate, trigger, references on tables from anon, authenticated',
        _owner
      );
      raise notice 'default privileges narrowed for role %', _owner;
    exception
      when insufficient_privilege or undefined_object then
        raise notice 'skipped default privileges for role % (not permitted here)', _owner;
    end;
  end loop;
end $$;

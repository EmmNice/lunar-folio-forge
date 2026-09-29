-- Remove write grants from the anonymous role.
--
-- Supabase grants ALL on tables in the public schema to `anon` and
-- `authenticated` by default, and relies entirely on RLS to stop anonymous
-- writes. That works — the audit confirms no policy permits an anon write — but
-- it leaves table-level INSERT/UPDATE/DELETE grants that nothing needs, so a
-- future policy added without a role qualifier could become anon-writable by
-- accident.
--
-- Anonymous visitors only ever read public content: the landing page, the feed,
-- and public profiles. Everything that writes requires a session.
--
-- SELECT is deliberately left in place, and `authenticated` is untouched.

revoke insert, update, delete, truncate on all tables in schema public from anon;

-- Cover tables created after this migration runs.
alter default privileges in schema public
  revoke insert, update, delete on tables from anon;

-- Sequences: anon has no reason to advance one.
revoke usage, update on all sequences in schema public from anon;

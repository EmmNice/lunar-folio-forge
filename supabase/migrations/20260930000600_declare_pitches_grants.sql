-- Gives `pitches` the grants it has only been getting by accident.
--
-- Every other table in the schema declares its own privileges — 89 grant
-- statements across the migrations. `pitches` declares none. It works in
-- production because Supabase's default privileges hand new tables in `public`
-- to anon and authenticated automatically, so the table arrived pre-granted and
-- nobody noticed the omission.
--
-- Two problems with leaving it:
--
--   1. The schema is not reproducible. Apply these migrations to an empty
--      database — a new staging project, `supabase db reset`, a local stack — and
--      pitches has no grants at all, so every pitch request fails with 42501
--      despite three correct RLS policies sitting on the table. Found exactly
--      that way: removing a blanket `grant ... on all tables` from the e2e
--      harness turned "Gold member CAN send a pitch" into a privilege error.
--   2. 20260930000500 narrowed those same defaults. A privilege that arrives by
--      default and is then partially revoked, with nothing stating the intent, is
--      impossible to review — you cannot tell the remaining privileges from an
--      oversight.
--
-- These are exactly the privileges production holds today, verified before
-- writing this, and they line up one-to-one with the policies:
--
--   pitches_insert_verified  (INSERT) — sender must be silver or gold
--   pitches_select_parties   (SELECT) — sender and recipient only
--   pitches_update_recipient (UPDATE) — recipient marks it read/replied
--
-- So this changes nothing about how production behaves. It makes the intent
-- explicit and the schema self-contained.

grant select, insert, update on public.pitches to authenticated;
grant all on public.pitches to service_role;

-- Deliberately not granted:
--   DELETE — there is no DELETE policy; a pitch is a record of contact, and the
--            recipient's remedy is a block, not erasing the evidence.
--   anon   — a pitch is private to two parties, neither of whom can be anonymous.

comment on table public.pitches is
  'Direct pitches from verified members to Gold members. Privileges are declared '
  'in 20260930000600 rather than inherited from Supabase''s default privileges, '
  'so the table behaves the same in a database built from these migrations alone.';

-- Take the privileged helpers away from `authenticated`.
--
-- 20260928000100 revoked the quota functions from `public` and `anon`, which is
-- not enough on hosted Supabase: it grants EXECUTE on newly created functions in
-- the public schema to `anon` and `authenticated` by default, so `authenticated`
-- kept the grant. Verified on the live project — all three were callable by any
-- signed-in user:
--
--   refund_ai_credit(<own id>)        called repeatedly -> counter floors at 0,
--                                    i.e. unlimited PulseAssist for free
--   consume_ai_credit(<other id>, n)  burns somebody else's daily quota
--   claim_conversation_slot(...)      same, for the DM quota
--
-- These are only ever meant to be called by a server function holding the
-- service-role key, after requireSupabaseAuth has established who the caller is.
-- The caller's id is an argument, so leaving them exposed lets a client both
-- forge the subject and choose the cap.
--
-- `revoke ... from public` does not imply the named roles, so each role is listed
-- explicitly. Written to be safe to re-run.

revoke all on function public.consume_ai_credit(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_ai_credit(uuid, integer, integer) to service_role;

revoke all on function public.claim_conversation_slot(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_conversation_slot(uuid, integer) to service_role;

revoke all on function public.refund_ai_credit(uuid)
  from public, anon, authenticated;
grant execute on function public.refund_ai_credit(uuid) to service_role;

-- Trigger functions are invoked by the trigger, never called directly, so no
-- client role needs EXECUTE. Same treatment as handle_new_user in 20260713041210.
revoke all on function public.guard_privileged_profile_columns()
  from public, anon, authenticated;

-- is_admin() must stay callable by `authenticated` — the RLS policies depend on
-- it — but `anon` has no use for it. It reads auth.uid(), so for an anonymous
-- caller it can only ever return false; revoked anyway to keep the surface tight.
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

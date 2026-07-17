-- ============================================================
-- FIX: Correct has_role() argument order in verification_requests RLS
-- The V2 migration passed args as has_role('admin', auth.uid()) but the
-- function signature is has_role(_user_id uuid, _role app_role), so
-- 'admin' was being cast to uuid → Postgres type error on every
-- authenticated SELECT from verification_requests.
-- Run this ONCE in: Supabase Dashboard → SQL Editor → New query → Run.
-- ============================================================

DROP POLICY IF EXISTS "admins can read all verification requests" ON public.verification_requests;
CREATE POLICY "admins can read all verification requests"
  ON public.verification_requests
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admins can update verification requests" ON public.verification_requests;
CREATE POLICY "admins can update verification requests"
  ON public.verification_requests
  FOR UPDATE TO authenticated
  USING  (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Fix the has_role() argument order in the verification_requests policies.
--
-- 20260717_verification_v2_dual_track.sql passed has_role('admin', auth.uid()),
-- but the signature is has_role(_user_id uuid, _role app_role). Postgres tried
-- to cast 'admin' to uuid, so every authenticated SELECT on
-- verification_requests failed with a type error.
--
-- This file must sort after 20260717_verification_v2_dual_track.sql, which is
-- why it carries a full timestamp.

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

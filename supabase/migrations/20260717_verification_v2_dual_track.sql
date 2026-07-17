-- ============================================================
-- VERIFICATION V2 — Dual-track Silver Builder / Gold Investor
-- Extends the existing verification_requests table with
-- tier-specific fields and admin review policies.
-- ============================================================

ALTER TABLE public.verification_requests
  ADD COLUMN IF NOT EXISTS github_url              text,
  ADD COLUMN IF NOT EXISTS deployed_contract_address text,
  ADD COLUMN IF NOT EXISTS live_project_url        text,
  ADD COLUMN IF NOT EXISTS recent_ship_desc        text,
  ADD COLUMN IF NOT EXISTS fund_or_company_name    text,
  ADD COLUMN IF NOT EXISTS portfolio_url           text,
  ADD COLUMN IF NOT EXISTS linkedin_or_x_url       text,
  ADD COLUMN IF NOT EXISTS invite_code             text;

-- Ship description is a short field (100 chars max, mirrors UI limit)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recent_ship_desc_len'
      AND conrelid = 'public.verification_requests'::regclass
  ) THEN
    ALTER TABLE public.verification_requests
      ADD CONSTRAINT recent_ship_desc_len
        CHECK (recent_ship_desc IS NULL OR char_length(recent_ship_desc) <= 100);
  END IF;
END $$;

-- ── Admin can read all requests (to power the review dashboard) ───────────
-- Users already have SELECT on their own rows.  Admins need SELECT on all.
DROP POLICY IF EXISTS "admins can read all verification requests" ON public.verification_requests;
CREATE POLICY "admins can read all verification requests"
  ON public.verification_requests
  FOR SELECT TO authenticated
  USING (public.has_role('admin', auth.uid()));

-- Admins update status when approving / rejecting.
-- Service-role bypasses RLS anyway, but the explicit policy keeps it tidy.
DROP POLICY IF EXISTS "admins can update verification requests" ON public.verification_requests;
CREATE POLICY "admins can update verification requests"
  ON public.verification_requests
  FOR UPDATE TO authenticated
  USING  (public.has_role('admin', auth.uid()))
  WITH CHECK (public.has_role('admin', auth.uid()));

-- Extend grants so authenticated admins can UPDATE directly.
GRANT SELECT, INSERT, UPDATE ON public.verification_requests TO authenticated;

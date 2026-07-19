-- Extend notifications to support verification events
-- Drop the old CHECK constraint and add a broader one

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('like', 'comment', 'repost', 'verification_approved', 'verification_rejected'));

-- Add optional metadata column for extra context (e.g. tier)
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS metadata JSONB;

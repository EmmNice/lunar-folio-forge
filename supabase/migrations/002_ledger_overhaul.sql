-- 002_ledger_overhaul.sql
-- Run this in Supabase Dashboard → SQL Editor

-- ── Posts: privacy & comment controls ──────────────────────────────────────
ALTER TABLE posts ADD COLUMN IF NOT EXISTS comments_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public';

-- ── Profiles: subscription, PulseAssist credits, pitch limit ───────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ai_credits_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ai_credits_reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pitch_limit INTEGER DEFAULT NULL;
-- pitch_limit: NULL = unlimited, 0 = Do Not Disturb, N = weekly max

-- ── Pitches table (Gold investor inbound pitch inbox) ──────────────────────
CREATE TABLE IF NOT EXISTS pitches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  pitch TEXT NOT NULL,
  deck_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE pitches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pitches_select_parties" ON pitches;
CREATE POLICY "pitches_select_parties" ON pitches
  FOR SELECT USING (recipient_id = auth.uid() OR sender_id = auth.uid());

DROP POLICY IF EXISTS "pitches_insert_verified" ON pitches;
CREATE POLICY "pitches_insert_verified" ON pitches
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND verification_tier IN ('silver', 'gold')
    )
  );

DROP POLICY IF EXISTS "pitches_update_recipient" ON pitches;
CREATE POLICY "pitches_update_recipient" ON pitches
  FOR UPDATE USING (recipient_id = auth.uid());

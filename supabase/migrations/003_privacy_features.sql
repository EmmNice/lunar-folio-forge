-- 003_privacy_features.sql
-- Run this in Supabase Dashboard → SQL Editor
-- Adds DM Cloaking to profiles.
-- Whisper Feed uses the existing posts.visibility column (value: 'whisper') — no schema change needed.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS dm_cloaking_enabled BOOLEAN NOT NULL DEFAULT FALSE;

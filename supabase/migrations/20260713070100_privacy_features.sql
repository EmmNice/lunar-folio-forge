-- Adds DM cloaking to profiles.
-- The whisper feed reuses the existing posts.visibility column (value 'whisper'),
-- so it needs no schema change of its own.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS dm_cloaking_enabled BOOLEAN NOT NULL DEFAULT FALSE;

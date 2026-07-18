-- Add hide_from_search column so users can opt out of search engine indexing.
-- Default false — no change for existing users.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hide_from_search BOOLEAN NOT NULL DEFAULT false;

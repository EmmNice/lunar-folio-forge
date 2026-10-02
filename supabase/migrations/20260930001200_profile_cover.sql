-- A cover photo for each profile, the banner across the top, as on X.
--
-- Stored in the existing `avatars` bucket under the member's own folder
-- ({user_id}/cover-*). That bucket's storage policies already limit writes to
-- `(storage.foldername(name))[1] = auth.uid()`, so the only new database object is
-- this column. A separate `covers` bucket would need a second, duplicate set of
-- policies to keep in step with the first.

alter table public.profiles
  add column if not exists cover_url text;

-- Same rule as avatar_url (20260929000400). This value ends up in an <img src>, so
-- `javascript:` and `data:` URLs are refused, not just "unlikely".
alter table public.profiles
  drop constraint if exists profiles_cover_url_scheme;
alter table public.profiles
  add constraint profiles_cover_url_scheme
  check (cover_url is null or cover_url ~* '^https?://');

comment on column public.profiles.cover_url is
  'Profile banner image. Public URL in the avatars bucket under the owner''s folder.';

-- Column-level grants, because profiles uses them (20260929000100). Without these,
-- setting a cover fails with a privilege error, and reading one returns 401 for
-- signed-out visitors.
grant select (cover_url) on public.profiles to anon, authenticated;
grant update (cover_url) on public.profiles to authenticated;

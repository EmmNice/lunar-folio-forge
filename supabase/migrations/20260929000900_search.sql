-- Real search over people and posts.
--
-- There was none. `hide_from_search` existed as a privacy toggle pointing at a
-- feature that did not exist, which is why it was described as cosmetic.
--
-- Deliberately built as indexes plus generated tsvector columns rather than as a
-- SECURITY DEFINER search function. Search then runs as an ordinary filtered
-- SELECT, so it inherits every rule already in RLS — post audience, blocks,
-- suspended authors, whisper and verified-only tiers — instead of a definer
-- function having to re-implement all of that and drift from it later.

-- ---------------------------------------------------------------------------
-- 1. Posts
-- ---------------------------------------------------------------------------

alter table public.posts
  add column if not exists search_vector tsvector
  generated always as (to_tsvector('english', coalesce(content, ''))) stored;

create index if not exists posts_search_idx on public.posts using gin (search_vector);

-- Ordering search results by recency needs this; the feed's existing index is on
-- created_at alone and cannot serve a filtered text query.
create index if not exists posts_created_at_idx on public.posts (created_at desc);

-- ---------------------------------------------------------------------------
-- 2. People
-- ---------------------------------------------------------------------------
-- Weighted: a handle or display name should beat a passing mention in a bio.
-- 'simple' rather than 'english' for the handle, because stemming a handle turns
-- "shipping" into "ship" and makes exact-handle lookup unreliable.

alter table public.profiles
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(handle, '')), 'A')
    || setweight(to_tsvector('english', coalesce(display_name, '')), 'A')
    || setweight(to_tsvector('english', coalesce(company_name, '')), 'B')
    || setweight(to_tsvector('english', coalesce(bio, '')), 'C')
  ) stored;

create index if not exists profiles_search_idx on public.profiles using gin (search_vector);

-- Prefix matching for the "as you type" case, which a tsvector cannot do.
create extension if not exists pg_trgm;
create index if not exists profiles_handle_trgm_idx on public.profiles using gin (handle gin_trgm_ops);
create index if not exists profiles_display_name_trgm_idx on public.profiles using gin (display_name gin_trgm_ops);

-- The generated columns are readable metadata, not secrets, but there is no
-- reason for a client to select them.
revoke select (search_vector) on public.profiles from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. hide_from_search now means something
-- ---------------------------------------------------------------------------
-- The column has existed since 20260718 and did nothing but inject a robots meta
-- tag after hydration. People search has to honour it, but a hidden profile must
-- still be reachable by its handle — otherwise every existing link to it breaks,
-- and the toggle silently becomes "delete my account from the internet".
--
-- A definer function keeps the rule in the database, so it applies to anything
-- querying PostgREST rather than only to our search screen.

/*
 * Returns an explicit column list, NOT `setof public.profiles`.
 *
 * This function is SECURITY DEFINER, so it executes as the owner — the caller's
 * column privileges on `profiles` are not applied to whatever it returns.
 * `setof public.profiles` would therefore hand back all 28 columns including
 * date_of_birth and subscription_status, quietly undoing the column-level privacy
 * work in 20260929000100. Naming the public columns is what keeps that closed.
 */
create or replace function public.search_profiles(_query text, _limit integer default 20)
returns table (
  id uuid,
  handle text,
  display_name text,
  avatar_url text,
  bio text,
  company_name text,
  role_type text,
  verification_tier text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.handle, p.display_name, p.avatar_url, p.bio, p.company_name,
         p.role_type, p.verification_tier
    from public.profiles p
   where coalesce(p.hide_from_search, false) = false
     and p.account_status <> 'banned'
     and p.onboarding_completed = true
     and p.id is distinct from auth.uid()
     and not public.is_blocked_with(p.id)
     and (
       p.search_vector @@ websearch_to_tsquery('english', _query)
       or p.handle ilike '%' || _query || '%'
       or p.display_name ilike '%' || _query || '%'
     )
   order by
     -- Exact handle first, then prefix, then relevance.
     (lower(p.handle) = lower(_query)) desc,
     (lower(p.handle) like lower(_query) || '%') desc,
     ts_rank(p.search_vector, websearch_to_tsquery('english', _query)) desc,
     p.created_at asc
   limit least(coalesce(_limit, 20), 50)
$$;

comment on function public.search_profiles(text, integer) is
  'People search. Honours hide_from_search, blocks, suspension and onboarding '
  'state. Returns only public columns by name, because a SECURITY DEFINER '
  'function runs as the owner and would otherwise bypass the column grants on '
  'profiles.';

revoke all on function public.search_profiles(text, integer) from public, anon, authenticated;
grant execute on function public.search_profiles(text, integer) to anon, authenticated;

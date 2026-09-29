-- Make posts.background and posts.visibility mean what the UI says they mean.
--
-- Two separate bugs, both invisible from a code read:
--
-- 1. BROKEN FEATURE. StatusCard offers seven card themes (noir, cream, gradient,
--    gold, steel, emerald, midnight) and Studio renders a picker for all seven,
--    but the original CHECK was `background in ('noir','cream')` and no later
--    migration touched it. Choosing any of the other five made Publish fail and
--    dumped the raw Postgres constraint error into a toast. Five of the seven
--    themes have never worked in production.
--
-- 2. UNENFORCED PRIVACY. `visibility` is 'public' | 'verified_only' | 'whisper'
--    (Gold-only), but it had no CHECK constraint and the SELECT policy was
--    `USING (true)`. The audience rule lived only in a JS filter in feed.tsx, so
--    every restricted post was still shipped to every browser -- and readable
--    directly with `GET /rest/v1/posts?select=*` using the bundled key. The
--    profile page didn't even apply the JS filter. "Whisper" was a label, not a
--    boundary.
--
-- Fixing (2) in RLS also means a member cannot publish to an audience their tier
-- doesn't entitle them to, which was likewise a client-only gate in Studio.

-- ---------------------------------------------------------------------------
-- 1. Domains
-- ---------------------------------------------------------------------------

alter table public.posts drop constraint if exists background_kind;
alter table public.posts add constraint background_kind
  check (background in ('noir', 'cream', 'gradient', 'gold', 'steel', 'emerald', 'midnight'));

-- Normalise anything unexpected before pinning the domain, so the constraint
-- cannot fail to validate on an existing row.
update public.posts
   set visibility = 'public'
 where visibility is null
    or visibility not in ('public', 'verified_only', 'whisper');

alter table public.posts alter column visibility set not null;
alter table public.posts alter column visibility set default 'public';

alter table public.posts drop constraint if exists posts_visibility_valid;
alter table public.posts add constraint posts_visibility_valid
  check (visibility in ('public', 'verified_only', 'whisper'));

-- ---------------------------------------------------------------------------
-- 2. Audience helpers
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because these read profiles.account_status and
-- profiles.verification_tier; account_status is no longer granted to
-- `authenticated` (see 20260929000100) and a policy expression that touches an
-- unreadable column fails with 42501 rather than returning false.

create or replace function public.can_view_post(_author_id uuid, _visibility text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- Authors always see their own work, including while banned.
    when _author_id = auth.uid() then true

    -- A banned member's posts stay in the database (so moderation is reversible
    -- and reviewable) but leave the public timeline.
    when exists (
      select 1 from public.profiles
      where id = _author_id and account_status = 'banned'
    ) then public.is_admin()

    when coalesce(_visibility, 'public') = 'public' then true

    -- Everything below this line requires a signed-in viewer.
    when auth.uid() is null then false

    when _visibility = 'verified_only' then exists (
      select 1 from public.profiles
      where id = auth.uid() and verification_tier in ('silver', 'gold')
    )

    when _visibility = 'whisper' then exists (
      select 1 from public.profiles
      where id = auth.uid() and verification_tier = 'gold'
    )

    else false
  end
$$;

comment on function public.can_view_post(uuid, text) is
  'Audience check for a single post, used by the posts SELECT policy. Authors and '
  'admins always pass; banned authors'' posts are hidden; verified_only needs '
  'Silver or Gold; whisper needs Gold.';

-- anon keeps EXECUTE here: the posts SELECT policy applies to anonymous visitors
-- too, and a policy that calls a function the caller cannot execute fails with
-- 42501 instead of returning false -- which would break the public feed.
revoke all on function public.can_view_post(uuid, text) from public, anon, authenticated;
grant execute on function public.can_view_post(uuid, text) to anon, authenticated;

create or replace function public.can_publish_to(_visibility text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case coalesce(_visibility, 'public')
    when 'public' then true
    when 'verified_only' then exists (
      select 1 from public.profiles
      where id = auth.uid() and verification_tier in ('silver', 'gold')
    )
    when 'whisper' then exists (
      select 1 from public.profiles
      where id = auth.uid() and verification_tier = 'gold'
    )
    else false
  end
$$;

comment on function public.can_publish_to(text) is
  'True when the caller''s verification tier entitles them to publish to this '
  'audience. Studio gated this in the browser only.';

revoke all on function public.can_publish_to(text) from public, anon, authenticated;
grant execute on function public.can_publish_to(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Policies
-- ---------------------------------------------------------------------------

drop policy if exists "posts are viewable by everyone" on public.posts;
drop policy if exists "posts are viewable by their audience" on public.posts;
create policy "posts are viewable by their audience" on public.posts
  for select to anon, authenticated
  using (public.can_view_post(author_id, visibility));

-- Recreated from 20260929000000 with the audience entitlement added.
drop policy if exists "active users can create posts" on public.posts;
create policy "active users can create posts" on public.posts
  for insert to authenticated
  with check (
    auth.uid() = author_id
    and public.actor_is_active()
    and public.can_publish_to(visibility)
  );

drop policy if exists "users can update own posts" on public.posts;
create policy "users can update own posts" on public.posts
  for update to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id and public.can_publish_to(visibility));

-- ---------------------------------------------------------------------------
-- 4. comments_enabled was also browser-only
-- ---------------------------------------------------------------------------
-- PostCard just hides the reply box when comments_enabled is false; RLS never
-- consulted the column, so a reply could still be POSTed to a closed thread.

create or replace function public.post_accepts_comments(_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select comments_enabled from public.posts where id = _post_id),
    false
  )
$$;

revoke all on function public.post_accepts_comments(uuid) from public, anon, authenticated;
grant execute on function public.post_accepts_comments(uuid) to authenticated;

drop policy if exists "active users can comment" on public.comments;
create policy "active users can comment" on public.comments
  for insert to authenticated
  with check (
    auth.uid() = author_id
    and public.actor_is_active()
    and public.post_accepts_comments(post_id)
  );

-- ---------------------------------------------------------------------------
-- 5. Self-reposts
-- ---------------------------------------------------------------------------
-- The Re-Ship button is disabled on your own card, but nothing stopped a direct
-- insert, and the notification trigger then skipped it -- so a self-repost just
-- silently inflated your own count.

delete from public.reposts r
 using public.posts p
 where p.id = r.post_id and p.author_id = r.user_id;

drop policy if exists "active users can repost" on public.reposts;
create policy "active users can repost" on public.reposts
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and public.actor_is_active()
    and not exists (
      select 1 from public.posts p
      where p.id = reposts.post_id and p.author_id = auth.uid()
    )
  );

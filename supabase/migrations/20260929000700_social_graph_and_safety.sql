-- Follows, blocks and mutes.
--
-- A follow graph existed in the first migration and was dropped by the second in
-- favour of one global chronological timeline. That decision is deliberate and is
-- kept: Explore stays the whole platform in time order. Following is an
-- additional lens on top, not a replacement, so the product does not quietly turn
-- into a feed you have to curate before it works.
--
-- Blocks and mutes are different things and are enforced in different places:
--
--   block — a boundary. Symmetric for visibility: neither party sees the other's
--           posts, comments, likes or threads, and neither can start a
--           conversation, pitch or follow. Enforced in RLS, because the browser
--           holds a publishable key and can query PostgREST directly.
--   mute  — a preference. One-directional and feed-only: their posts stop
--           appearing in your timeline, but you can still open their profile and
--           they are not told. Enforced in the feed query, NOT in RLS, because a
--           mute that hid their profile too would be a block wearing a
--           different label.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint no_self_follow check (follower_id <> following_id)
);

create index if not exists follows_following_idx on public.follows (following_id);
create index if not exists follows_follower_idx on public.follows (follower_id);

create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);

create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

create table if not exists public.mutes (
  muter_id uuid not null references public.profiles(id) on delete cascade,
  muted_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  constraint no_self_mute check (muter_id <> muted_id)
);

alter table public.follows enable row level security;
alter table public.blocks enable row level security;
alter table public.mutes enable row level security;

revoke all on public.follows from anon, authenticated;
revoke all on public.blocks from anon, authenticated;
revoke all on public.mutes from anon, authenticated;

-- Follower counts are public; who you block or mute is nobody's business but
-- yours, so those two are select-own only and get no anon grant at all.
grant select on public.follows to anon, authenticated;
grant insert, delete on public.follows to authenticated;
grant select, insert, delete on public.blocks to authenticated;
grant select, insert, delete on public.mutes to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The block predicate
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it can read `blocks` from inside policies on other tables
-- without granting those tables' readers access to the block list itself.

create or replace function public.is_blocked_with(_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null or _other is null then false
    else exists (
      select 1 from public.blocks
      where (blocker_id = auth.uid() and blocked_id = _other)
         or (blocker_id = _other and blocked_id = auth.uid())
    )
  end
$$;

comment on function public.is_blocked_with(uuid) is
  'True when the caller and _other have blocked each other in either direction. '
  'Symmetric on purpose: a block should not be defeatable by the blocked party.';

revoke all on function public.is_blocked_with(uuid) from public, anon, authenticated;
grant execute on function public.is_blocked_with(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Policies
-- ---------------------------------------------------------------------------

drop policy if exists "follows are viewable by everyone" on public.follows;
create policy "follows are viewable by everyone" on public.follows
  for select to anon, authenticated using (true);

-- Blocking someone must also break any follow between you, which the server
-- function does explicitly. This policy stops a *new* follow across a block.
drop policy if exists "members can follow" on public.follows;
create policy "members can follow" on public.follows
  for insert to authenticated
  with check (
    auth.uid() = follower_id
    and public.actor_is_active()
    and not public.is_blocked_with(following_id)
  );

drop policy if exists "members can unfollow" on public.follows;
create policy "members can unfollow" on public.follows
  for delete to authenticated using (auth.uid() = follower_id);

drop policy if exists "members manage own blocks" on public.blocks;
create policy "members manage own blocks" on public.blocks
  for select to authenticated using (auth.uid() = blocker_id);
drop policy if exists "members can block" on public.blocks;
create policy "members can block" on public.blocks
  for insert to authenticated with check (auth.uid() = blocker_id);
drop policy if exists "members can unblock" on public.blocks;
create policy "members can unblock" on public.blocks
  for delete to authenticated using (auth.uid() = blocker_id);

drop policy if exists "members manage own mutes" on public.mutes;
create policy "members manage own mutes" on public.mutes
  for select to authenticated using (auth.uid() = muter_id);
drop policy if exists "members can mute" on public.mutes;
create policy "members can mute" on public.mutes
  for insert to authenticated with check (auth.uid() = muter_id);
drop policy if exists "members can unmute" on public.mutes;
create policy "members can unmute" on public.mutes
  for delete to authenticated using (auth.uid() = muter_id);

-- ---------------------------------------------------------------------------
-- 4. Blocks folded into the existing audience check
-- ---------------------------------------------------------------------------
-- can_view_post() is already the single gate for the posts SELECT policy, the
-- feed, the profile timeline, realtime and (from the next migration) search.
-- Putting the block check here means every one of those inherits it, rather than
-- each surface remembering to filter.

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

    -- A block hides content in both directions.
    when public.is_blocked_with(_author_id) then false

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

-- Comments, likes and reposts carry an author identity, so a block has to cover
-- them too — otherwise a blocked member's name still surfaces under a post.
drop policy if exists "comments are viewable by everyone" on public.comments;
create policy "comments are viewable by everyone" on public.comments
  for select to anon, authenticated
  using (not public.is_blocked_with(author_id));

drop policy if exists "likes are viewable by everyone" on public.likes;
create policy "likes are viewable by everyone" on public.likes
  for select to anon, authenticated
  using (not public.is_blocked_with(user_id));

drop policy if exists "reposts are viewable by everyone" on public.reposts;
create policy "reposts are viewable by everyone" on public.reposts
  for select to anon, authenticated
  using (not public.is_blocked_with(user_id));

-- A block ends the conversation: the thread stops being readable from either
-- side and no new message can be sent into it.
drop policy if exists "participants can view conversation" on public.conversations;
create policy "participants can view conversation" on public.conversations
  for select to authenticated
  using (
    (auth.uid() = user_a or auth.uid() = user_b)
    and not public.is_blocked_with(case when auth.uid() = user_a then user_b else user_a end)
  );

drop policy if exists "participants can send messages" on public.messages;
create policy "participants can send messages" on public.messages
  for insert to authenticated
  with check (
    auth.uid() = sender_id
    and public.actor_is_active()
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (auth.uid() = c.user_a or auth.uid() = c.user_b)
        and not public.is_blocked_with(case when auth.uid() = c.user_a then c.user_b else c.user_a end)
    )
  );

drop policy if exists pitches_insert_verified on public.pitches;
create policy pitches_insert_verified on public.pitches
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.actor_is_active()
    and not public.is_blocked_with(recipient_id)
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and verification_tier in ('silver', 'gold')
    )
  );

-- Notifications from a blocked member should stop arriving. The three triggers
-- are SECURITY DEFINER and run as the table owner, where auth.uid() is the actor,
-- so the pair check is written out directly rather than via is_blocked_with().
create or replace function public.blocked_pair(_a uuid, _b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = _a and blocked_id = _b)
       or (blocker_id = _b and blocked_id = _a)
  )
$$;

revoke all on function public.blocked_pair(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. Notification triggers respect blocks
-- ---------------------------------------------------------------------------
-- Without this, blocking someone still let their like or reply ring your bell:
-- the RLS change above hides the row behind the notification, so you would get a
-- notification pointing at content you cannot open.

create or replace function public.notify_on_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _author uuid;
begin
  select author_id into _author from public.posts where id = new.post_id;
  if _author is not null
     and _author <> new.user_id
     and not public.blocked_pair(_author, new.user_id) then
    insert into public.notifications (user_id, actor_id, type, post_id)
    values (_author, new.user_id, 'like', new.post_id);
  end if;
  return new;
end;
$$;

create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _author uuid;
  _parent_author uuid;
begin
  select author_id into _author from public.posts where id = new.post_id;

  -- A reply to a reply notifies the person being replied to, not just the post
  -- author. Without this, nested replies were invisible to their actual recipient.
  if new.parent_id is not null then
    select author_id into _parent_author from public.comments where id = new.parent_id;
    if _parent_author is not null
       and _parent_author <> new.author_id
       and not public.blocked_pair(_parent_author, new.author_id) then
      insert into public.notifications (user_id, actor_id, type, post_id)
      values (_parent_author, new.author_id, 'comment', new.post_id);
    end if;
  end if;

  if _author is not null
     and _author <> new.author_id
     and _author is distinct from _parent_author
     and not public.blocked_pair(_author, new.author_id) then
    insert into public.notifications (user_id, actor_id, type, post_id)
    values (_author, new.author_id, 'comment', new.post_id);
  end if;

  return new;
end;
$$;

create or replace function public.notify_on_repost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _author uuid;
begin
  select author_id into _author from public.posts where id = new.post_id;
  if _author is not null
     and _author <> new.user_id
     and not public.blocked_pair(_author, new.user_id) then
    insert into public.notifications (user_id, actor_id, type, post_id)
    values (_author, new.user_id, 'repost', new.post_id);
  end if;
  return new;
end;
$$;

create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _recipient uuid;
  _wants boolean;
begin
  select case when c.user_a = new.sender_id then c.user_b else c.user_a end
    into _recipient
    from public.conversations c
   where c.id = new.conversation_id;

  if _recipient is null
     or _recipient = new.sender_id
     or public.blocked_pair(_recipient, new.sender_id) then
    return new;
  end if;

  select coalesce((notification_prefs -> 'messages')::boolean, true)
    into _wants
    from public.profiles
   where id = _recipient;

  if not coalesce(_wants, true) then
    return new;
  end if;

  if exists (
    select 1 from public.notifications
     where user_id = _recipient
       and type = 'message'
       and conversation_id = new.conversation_id
       and read = false
  ) then
    return new;
  end if;

  insert into public.notifications (user_id, actor_id, type, conversation_id)
  values (_recipient, new.sender_id, 'message', new.conversation_id);

  return new;
end;
$$;

-- A new follower is worth knowing about.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'like', 'comment', 'repost',
    'verification_approved', 'verification_rejected',
    'message', 'pitch', 'follow'
  ));

create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.blocked_pair(new.following_id, new.follower_id) then
    insert into public.notifications (user_id, actor_id, type)
    values (new.following_id, new.follower_id, 'follow');
  end if;
  return new;
end;
$$;

revoke all on function public.notify_on_follow() from public, anon, authenticated;

drop trigger if exists trg_notify_follow on public.follows;
create trigger trg_notify_follow
  after insert on public.follows
  for each row execute function public.notify_on_follow();

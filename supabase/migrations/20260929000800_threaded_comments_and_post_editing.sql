-- Threaded replies, and letting people fix their own posts.
--
-- Comments were strictly flat: the UI rendered a thread but there was no
-- parent_id, so "replying" to a specific comment was impossible and a long
-- discussion had no structure. Posts had an UPDATE policy from the very first
-- migration and no UI ever used it, so a typo was permanent — the only remedy was
-- to delete and repost, losing the likes and replies.

-- ---------------------------------------------------------------------------
-- 1. Threaded comments
-- ---------------------------------------------------------------------------

alter table public.comments
  add column if not exists parent_id uuid references public.comments(id) on delete cascade;

create index if not exists comments_parent_idx on public.comments (parent_id);
create index if not exists comments_post_created_idx on public.comments (post_id, created_at);

/*
 * Depth is capped at two levels: a reply, and a reply to that reply.
 *
 * Unbounded nesting reads fine in a database and terribly on a phone — by the
 * fourth level the indent leaves no room for text. Capping it in the database
 * rather than the client means the limit holds for anything talking to PostgREST,
 * and it also rules out the pathological case of a very deep chain making the
 * recursive read expensive.
 */
create or replace function public.guard_comment_depth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _parent_post uuid;
  _parent_parent uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  select post_id, parent_id into _parent_post, _parent_parent
    from public.comments where id = new.parent_id;

  if _parent_post is null then
    raise exception 'parent comment does not exist' using errcode = '23503';
  end if;

  -- A reply has to live on the same post as the comment it answers, or a thread
  -- could be grafted onto an unrelated post to smuggle it past that post's
  -- audience rules.
  if _parent_post is distinct from new.post_id then
    raise exception 'a reply must belong to the same post as its parent'
      using errcode = '23514';
  end if;

  if _parent_parent is not null then
    -- The parent is already a reply, so this would be the third level.
    select parent_id into _parent_parent from public.comments where id = _parent_parent;
    if _parent_parent is not null then
      raise exception 'replies can only be nested two levels deep'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_comment_depth() from public, anon, authenticated;

drop trigger if exists comments_guard_depth on public.comments;
create trigger comments_guard_depth
  before insert on public.comments
  for each row execute function public.guard_comment_depth();

-- Reparenting an existing comment would let someone move a reply under a
-- different post after the fact, so the thread shape is fixed once written.
create or replace function public.guard_comment_immutable_shape()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.parent_id is distinct from old.parent_id
     or new.post_id is distinct from old.post_id
     or new.author_id is distinct from old.author_id then
    raise exception 'a comment cannot be moved or reattributed' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_comment_immutable_shape() from public, anon, authenticated;

drop trigger if exists comments_guard_shape on public.comments;
create trigger comments_guard_shape
  before update on public.comments
  for each row execute function public.guard_comment_immutable_shape();

-- ---------------------------------------------------------------------------
-- 2. Post editing
-- ---------------------------------------------------------------------------

alter table public.posts
  add column if not exists edited_at timestamptz;

comment on column public.posts.edited_at is
  'Set by the touch_post_edited trigger whenever the body or audience changes. '
  'Null means never edited. Surfaced in the UI so an edit is never silent.';

/*
 * Stamp edits automatically.
 *
 * Leaving this to the client would make "edited" advisory — anyone PATCHing the
 * row directly could rewrite a post and leave no mark. The trigger also refuses
 * to let a member backdate or clear the stamp.
 *
 * created_at and author_id are pinned here too: without that, an edit could
 * reorder the timeline or hand the post to somebody else.
 */
create or replace function public.touch_post_edited()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception 'a post cannot be reattributed or backdated'
      using errcode = '42501';
  end if;

  if new.content is distinct from old.content
     or new.visibility is distinct from old.visibility
     or new.background is distinct from old.background
     or new.comments_enabled is distinct from old.comments_enabled then
    new.edited_at := now();
  else
    -- Nothing substantive changed; don't let the stamp be set or cleared by hand.
    new.edited_at := old.edited_at;
  end if;

  return new;
end;
$$;

revoke all on function public.touch_post_edited() from public, anon, authenticated;

drop trigger if exists posts_touch_edited on public.posts;
create trigger posts_touch_edited
  before update on public.posts
  for each row execute function public.touch_post_edited();

-- `authenticated` may write the body and its presentation, and nothing else.
-- The UPDATE policy already scoped rows to the author; this scopes the columns,
-- so the triggers above are not the only thing standing in the way.
revoke update on public.posts from authenticated;
grant update (content, background, visibility, comments_enabled, image_url, edited_at)
  on public.posts to authenticated;

-- A post can be edited for ten minutes, then it is on the record.
--
-- Editing was unlimited in time. On a platform whose whole premise is a public,
-- chronological record of what people shipped, that is the wrong default: a post
-- can collect replies, likes and re-ships for a week and then have its meaning
-- rewritten underneath all of them. Everyone who engaged did so with different
-- text, and nothing anywhere says so.
--
-- Ten minutes covers what editing is actually for — a typo, a broken link, a
-- sentence that came out wrong — and stops short of letting an argument be
-- retroactively won.
--
-- Deletion is untouched. Withdrawing something entirely is honest in a way that
-- silently rewriting it is not, and the replies go with it.

-- ---------------------------------------------------------------------------
-- The window, in one place
-- ---------------------------------------------------------------------------
-- A function rather than a literal in the trigger, because the client needs the
-- same number to decide whether to offer an Edit button at all, and two copies of
-- a policy drift.
create or replace function public.post_edit_window()
returns interval
language sql
immutable
as $$ select interval '10 minutes' $$;

grant execute on function public.post_edit_window() to anon, authenticated;

comment on function public.post_edit_window() is
  'How long after posting an edit is allowed. Read by the edit guard and exposed '
  'to the client so the UI and the database cannot disagree about it.';

-- ---------------------------------------------------------------------------
-- Enforced in the existing edit guard
-- ---------------------------------------------------------------------------
/*
 * Extends touch_post_edited (20260929000800) rather than adding a second trigger:
 * the checks belong together, and this one has to run before edited_at is stamped
 * or a refused edit would still move the stamp.
 *
 * Only substantive changes are gated. A post whose content, audience, theme and
 * comment setting are all unchanged is not an edit — the trigger already treats it
 * that way — so letting it through keeps unrelated writes (an image_url backfill,
 * a moderation tool) working after the window closes.
 *
 * auth.uid() is null for the service role, which is how moderation and admin
 * tooling keep working: a human reviewer redacting something is not an author
 * editing their own post.
 */
create or replace function public.touch_post_edited()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _substantive boolean;
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception 'a post cannot be reattributed or backdated'
      using errcode = '42501';
  end if;

  _substantive :=
    new.content is distinct from old.content
    or new.visibility is distinct from old.visibility
    or new.background is distinct from old.background
    or new.comments_enabled is distinct from old.comments_enabled;

  if _substantive then
    if old.created_at < now() - public.post_edit_window() then
      raise exception 'posts can only be edited within % of publishing',
        public.post_edit_window()
        using errcode = '42501';
    end if;
    new.edited_at := now();
  else
    -- Nothing substantive changed; don't let the stamp be set or cleared by hand.
    new.edited_at := old.edited_at;
  end if;

  return new;
end;
$$;

revoke all on function public.touch_post_edited() from public, anon, authenticated;

-- The trigger itself is unchanged and still bound to this function name; recreated
-- only so this file is self-contained if replayed against a fresh database.
drop trigger if exists posts_touch_edited on public.posts;
create trigger posts_touch_edited
  before update on public.posts
  for each row execute function public.touch_post_edited();

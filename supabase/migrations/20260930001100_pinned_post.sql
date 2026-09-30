-- Lets a member pin one of their own posts to the top of their profile.
--
-- A profile is a reverse-chronological list, which means the thing somebody most
-- wants read — what they are building, what they are raising, what they want to be
-- judged on — sinks as they keep posting. Pinning is how that gets fixed on every
-- other platform, and the absence of it here means a first-time visitor sees
-- whatever happened to be most recent.
--
-- One post, not a list. Two pinned posts is a second feed, and the whole value of
-- a pin is that it is the one thing you are pointing at.

alter table public.profiles
  add column if not exists pinned_post_id uuid;

/*
 * ON DELETE SET NULL, so deleting a pinned post unpins it rather than being
 * blocked by the reference — a member should never have to remember to unpin
 * something before they can remove it.
 */
alter table public.profiles
  drop constraint if exists profiles_pinned_post_fkey;
alter table public.profiles
  add constraint profiles_pinned_post_fkey
  foreign key (pinned_post_id) references public.posts(id) on delete set null;

comment on column public.profiles.pinned_post_id is
  'One post the member has pinned to the top of their own profile. Must be their '
  'own post and must be publicly visible — enforced by guard_pinned_post().';

create index if not exists profiles_pinned_post_idx
  on public.profiles (pinned_post_id)
  where pinned_post_id is not null;

-- ---------------------------------------------------------------------------
-- You may only pin your own post, and only a public one
-- ---------------------------------------------------------------------------
/*
 * Two rules, both of which a client alone cannot be trusted with.
 *
 * Ownership: pinning someone else's post to your profile would let you present
 * their words as the first thing anyone sees about you.
 *
 * Audience: a pin is the most prominent slot on a profile, and profiles are
 * readable by signed-out visitors. Pinning a `whisper` or `verified_only` post
 * there would either leak it or render an empty box to most viewers. Rather than
 * leave that to whichever component reads the pin, the pin itself is restricted to
 * public posts — so there is one rule instead of one per surface.
 */
create or replace function public.guard_pinned_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _author uuid;
  _visibility text;
begin
  if new.pinned_post_id is null
     or new.pinned_post_id is not distinct from old.pinned_post_id then
    return new;
  end if;

  select author_id, coalesce(visibility, 'public')
    into _author, _visibility
    from public.posts
   where id = new.pinned_post_id;

  if _author is null then
    raise exception 'that post does not exist' using errcode = '23503';
  end if;

  if _author <> new.id then
    raise exception 'you can only pin your own post' using errcode = '42501';
  end if;

  if _visibility <> 'public' then
    raise exception 'only a public post can be pinned to your profile'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_pinned_post() from public, anon, authenticated;

drop trigger if exists profiles_guard_pinned_post on public.profiles;
create trigger profiles_guard_pinned_post
  before insert or update of pinned_post_id on public.profiles
  for each row execute function public.guard_pinned_post();

-- ---------------------------------------------------------------------------
-- Members may set their own pin
-- ---------------------------------------------------------------------------
-- `authenticated` holds column-level UPDATE on profiles (20260929000100), so the
-- new column has to be granted explicitly or pinning fails with a privilege error.
-- The row is already scoped to the owner by the existing UPDATE policy; the trigger
-- above is what checks *which* post may go in it.
grant update (pinned_post_id) on public.profiles to authenticated;

-- Readable by everyone, because a pinned post is the most public thing on a
-- profile. anon already has column-level SELECT on the public profile columns.
grant select (pinned_post_id) on public.profiles to anon, authenticated;

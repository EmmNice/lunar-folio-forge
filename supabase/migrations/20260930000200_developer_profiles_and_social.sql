-- Makes a profile read as a developer's identity and work, and completes the
-- social loop around it: mentions, bookmarks, and skills that are searchable.
--
-- The profile already carried a founder's identity well — role, company,
-- availability_status with values like 'raising_capital' and 'seeking_cofounder'.
-- What it could not express was the thing a developer is actually judged on: what
-- they build and what they build it with. There was nowhere to put a language, a
-- framework, a project or a repo link, so two people who both picked "Core
-- Developer" were indistinguishable.
--
-- Everything here is additive. No founder-oriented field is removed or repurposed,
-- because that identity is the platform's and not mine to overwrite.

-- ---------------------------------------------------------------------------
-- 1. Skills
-- ---------------------------------------------------------------------------
/*
 * A text[] rather than a `skills` table with a join.
 *
 * Postgres arrays are first-class here: GIN-indexed `&&` and `@>` answer "who
 * knows Rust" as fast as a join would, and skills have no attributes of their own
 * to normalise — no description, no canonical id, nothing that a second table
 * would hold. A join table would add two queries to every profile render to store
 * a list of words.
 *
 * The trade-off, stated: there is no controlled vocabulary, so 'nodejs' and
 * 'node.js' are different skills. Normalising to lowercase and trimming gets most
 * of the way there; a curated tag list is a product decision for when there are
 * enough profiles to see what people actually type.
 */
alter table public.profiles
  add column if not exists skills text[] not null default '{}';

/*
 * Validated through an IMMUTABLE function rather than inline.
 *
 * A CHECK cannot contain a subquery, and checking "no element is empty or
 * overlong" needs unnest(). Wrapping it in an immutable function is the supported
 * way to get there, and it keeps the rule in the constraint — so it holds for the
 * service role and for SQL run by hand, not only for clients that go through the
 * normalising trigger below.
 */
create or replace function public.skills_are_sane(_skills text[])
returns boolean
language sql
immutable
as $$
  select _skills is null
      or array_length(_skills, 1) is null
      or (
           array_length(_skills, 1) <= 20
           and not exists (
             select 1 from unnest(_skills) s
              where btrim(s) = '' or char_length(s) > 30
           )
         )
$$;

alter table public.profiles
  drop constraint if exists profiles_skills_sane;
alter table public.profiles
  add constraint profiles_skills_sane check (public.skills_are_sane(skills));

create index if not exists profiles_skills_idx on public.profiles using gin (skills);

comment on column public.profiles.skills is
  'Languages, frameworks and tools, max 20, each <=30 chars. GIN-indexed so '
  '`skills && array[...]` can drive discovery.';

/* Normalised on write so 'Rust', ' rust ' and 'rust' are one skill. */
create or replace function public.normalise_skills()
returns trigger
language plpgsql
as $$
begin
  if new.skills is null then
    new.skills := '{}';
    return new;
  end if;
  select coalesce(array_agg(distinct s order by s), '{}')
    into new.skills
    from (
      select btrim(lower(unnest(new.skills))) as s
    ) t
   where s <> '';
  return new;
end;
$$;

revoke all on function public.normalise_skills() from public, anon, authenticated;

drop trigger if exists profiles_normalise_skills on public.profiles;
create trigger profiles_normalise_skills
  before insert or update of skills on public.profiles
  for each row execute function public.normalise_skills();

-- ---------------------------------------------------------------------------
-- 2. Location
-- ---------------------------------------------------------------------------
-- Free text and always optional. A country/city picker would be more structured
-- and would also force people in places that resolve badly to misrepresent
-- themselves; "remote / UTC+1" is a legitimate answer a dropdown cannot express.
alter table public.profiles
  add column if not exists location text;

alter table public.profiles
  drop constraint if exists profiles_location_length;
alter table public.profiles
  add constraint profiles_location_length check (
    location is null or char_length(location) <= 80
  );

-- ---------------------------------------------------------------------------
-- 3. Availability, widened for people who are not founders
-- ---------------------------------------------------------------------------
-- The existing four values are all founder-shaped. A developer's answer to "what
-- are you open to" is a different set, and previously they had none.
alter table public.profiles
  drop constraint if exists profiles_availability_status_check;
alter table public.profiles
  add constraint profiles_availability_status_check check (
    availability_status is null or availability_status = any (array[
      -- Pre-existing, unchanged.
      'open_to_angel', 'raising_capital', 'seeking_cofounder', 'building_stealth',
      -- Added for builders.
      'open_to_work', 'open_to_collab', 'hiring', 'freelance'
    ])
  );

-- ---------------------------------------------------------------------------
-- 4. Role, widened for the same reason
-- ---------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_role_type_check;
alter table public.profiles
  add constraint profiles_role_type_check check (
    role_type is null or role_type = any (array[
      'founder', 'developer', 'pm', 'investor',
      'designer', 'devops', 'data', 'security', 'student'
    ])
  );

-- ---------------------------------------------------------------------------
-- 5. Pinned projects
-- ---------------------------------------------------------------------------
/*
 * The closest thing to GitHub's pinned repositories, and the part that makes a
 * profile about work rather than about an account.
 *
 * A real table, unlike skills, because a project has attributes — a name, a
 * description, a live URL, a repo URL, an order — and because these are rows
 * people add and remove individually.
 */
create table if not exists public.profile_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  url text,
  repo_url text,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint profile_projects_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint profile_projects_desc_len check (description is null or char_length(description) <= 200),
  -- Same URL discipline the profile link columns already use: no javascript: URLs.
  constraint profile_projects_url_scheme check (url is null or url ~ '^https?://'),
  constraint profile_projects_repo_scheme check (repo_url is null or repo_url ~ '^https?://'),
  constraint profile_projects_url_len check (url is null or char_length(url) <= 300),
  constraint profile_projects_repo_len check (repo_url is null or char_length(repo_url) <= 300)
);

create index if not exists profile_projects_user_idx
  on public.profile_projects (user_id, position, created_at);

alter table public.profile_projects enable row level security;
revoke all on public.profile_projects from anon, authenticated;
grant select on public.profile_projects to anon, authenticated;
grant insert, update, delete on public.profile_projects to authenticated;

/*
 * Visible exactly when the owner's posts are visible.
 *
 * Reuses can_view_post() with 'public' rather than spelling the rule out again.
 * That function is already the single audience gate — it checks the author is not
 * banned and that neither party has blocked the other — so projects inherit those
 * rules instead of drifting from them. Without the block half, blocking someone
 * would hide their posts and leave their project list readable, which is exactly
 * the sort of half-enforced boundary this schema has had to correct before.
 *
 * It also has to be a definer function rather than an inline EXISTS over
 * `profiles`. An RLS policy is evaluated as the *invoking* role, and
 * `account_status` is not granted to `authenticated` (20260929000100) — so reading
 * it inline made the policy itself fail with "permission denied for table
 * profiles" for every member, which is how this was caught.
 */
drop policy if exists "projects are viewable with the profile" on public.profile_projects;
create policy "projects are viewable with the profile" on public.profile_projects
  for select to anon, authenticated
  using (public.can_view_post(user_id, 'public'));

drop policy if exists "members manage own projects" on public.profile_projects;
create policy "members manage own projects" on public.profile_projects
  for insert to authenticated with check (auth.uid() = user_id and public.actor_is_active());
drop policy if exists "members update own projects" on public.profile_projects;
create policy "members update own projects" on public.profile_projects
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "members delete own projects" on public.profile_projects;
create policy "members delete own projects" on public.profile_projects
  for delete to authenticated using (auth.uid() = user_id);

/* Six is the cap. Pinned work stops being pinned work when it is a CV. */
create or replace function public.guard_project_count()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.profile_projects where user_id = new.user_id) >= 6 then
    raise exception 'you can pin up to 6 projects'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_project_count() from public, anon, authenticated;

drop trigger if exists profile_projects_cap on public.profile_projects;
create trigger profile_projects_cap
  before insert on public.profile_projects
  for each row execute function public.guard_project_count();

-- ---------------------------------------------------------------------------
-- 6. Bookmarks
-- ---------------------------------------------------------------------------
/*
 * Private saves. The one thing that matters here is that they are private: a
 * bookmark reveals interest, and a public "saved" list is a behavioural profile
 * nobody agreed to publish. So unlike likes — which are public and countable —
 * there is no policy letting anyone read anybody else's row, and no count exposed.
 */
create table if not exists public.bookmarks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists bookmarks_user_created_idx
  on public.bookmarks (user_id, created_at desc);

alter table public.bookmarks enable row level security;
revoke all on public.bookmarks from anon, authenticated;
grant select, insert, delete on public.bookmarks to authenticated;

drop policy if exists "members read own bookmarks" on public.bookmarks;
create policy "members read own bookmarks" on public.bookmarks
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "members add own bookmarks" on public.bookmarks;
create policy "members add own bookmarks" on public.bookmarks
  for insert to authenticated
  with check (auth.uid() = user_id and public.can_view_post(
    (select author_id from public.posts where id = post_id),
    (select visibility from public.posts where id = post_id)
  ));
drop policy if exists "members remove own bookmarks" on public.bookmarks;
create policy "members remove own bookmarks" on public.bookmarks
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 7. Mentions
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'like', 'comment', 'repost',
  'verification_approved', 'verification_rejected',
  'message', 'pitch', 'follow', 'mention'
]));

/*
 * Turns "@handle" in a post or comment into a notification.
 *
 * Handles are resolved against the database rather than trusted from the text, so
 * a mention of a name that does not exist is simply nothing. Blocks are honoured
 * via blocked_pair() — a block should stop someone reaching into your
 * notifications by typing your name — and self-mentions are skipped.
 *
 * DISTINCT because writing "@ana @ana" is one mention of one person.
 *
 * Deliberately not reconciled on edit: editing a post to add a mention does not
 * notify, because that would let someone repeatedly edit a post to ping the same
 * person. The notification belongs to the moment of writing.
 */
create or replace function public.notify_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _author uuid;
  _post   uuid;
  _target uuid;
begin
  if tg_table_name = 'posts' then
    _author := new.author_id;
    _post   := new.id;
  else
    _author := new.author_id;
    _post   := new.post_id;
  end if;

  for _target in
    select distinct p.id
      from regexp_matches(coalesce(new.content, ''), '@([a-z0-9_]{2,20})', 'g') as m
      join public.profiles p on p.handle = m[1]
     where p.id <> _author
  loop
    if not public.blocked_pair(_target, _author) then
      insert into public.notifications (user_id, actor_id, type, post_id)
      values (_target, _author, 'mention', _post);
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.notify_mentions() from public, anon, authenticated;

drop trigger if exists posts_notify_mentions on public.posts;
create trigger posts_notify_mentions
  after insert on public.posts
  for each row execute function public.notify_mentions();

drop trigger if exists comments_notify_mentions on public.comments;
create trigger comments_notify_mentions
  after insert on public.comments
  for each row execute function public.notify_mentions();

-- ---------------------------------------------------------------------------
-- 8. Skills and location become searchable
-- ---------------------------------------------------------------------------
-- The profile search vector is a generated column, so widening it means replacing
-- it. Dropping the index first avoids rebuilding it twice.
drop index if exists profiles_search_idx;
alter table public.profiles drop column if exists search_vector;

alter table public.profiles
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(handle, '')), 'A')
    || setweight(to_tsvector('english', coalesce(display_name, '')), 'A')
    /*
      Skills are weighted alongside the name: "rust" should find Rust developers,
      which is the main thing anyone will search this platform for.

      array_to_tsvector, not to_tsvector(array_to_string(...)) — array_to_string is
      only STABLE and a generated column requires IMMUTABLE. It also suits tags
      better: lexemes are taken verbatim with no stemming, so 'rust' stays 'rust'.
      The consequence worth knowing is that a multi-word skill becomes one lexeme,
      so "machine learning" is not found by searching "machine".
    */
    || setweight(array_to_tsvector(coalesce(skills, '{}')), 'B')
    || setweight(to_tsvector('english', coalesce(company_name, '')), 'B')
    || setweight(to_tsvector('english', coalesce(bio, '')), 'C')
    || setweight(to_tsvector('simple', coalesce(location, '')), 'C')
  ) stored;

create index profiles_search_idx on public.profiles using gin (search_vector);

-- ---------------------------------------------------------------------------
-- 9. New columns are readable, and writable only by their owner
-- ---------------------------------------------------------------------------
-- 20260929000100 replaced the blanket table grant with column-level grants, so a
-- column added afterwards is invisible until named here. Public-facing profile
-- fields, so anon gets SELECT alongside authenticated.
grant select (skills, location) on public.profiles to anon, authenticated;
grant update (skills, location) on public.profiles to authenticated;

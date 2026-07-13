
-- ============================================================
-- ROLES
-- ============================================================
create type public.app_role as enum ('admin', 'moderator', 'user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

alter table public.user_roles enable row level security;

create policy "users can view own roles" on public.user_roles
for select to authenticated using (auth.uid() = user_id);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- ============================================================
-- PROFILES
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique not null,
  display_name text not null,
  avatar_url text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint handle_format check (handle ~ '^[a-z0-9_]{2,20}$'),
  constraint display_name_len check (char_length(display_name) between 1 and 60),
  constraint bio_len check (bio is null or char_length(bio) <= 200)
);

grant select on public.profiles to anon;
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;

alter table public.profiles enable row level security;

create policy "profiles are viewable by everyone" on public.profiles
for select to anon, authenticated using (true);

create policy "users can insert own profile" on public.profiles
for insert to authenticated with check (auth.uid() = id);

create policy "users can update own profile" on public.profiles
for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_name text;
  raw_avatar text;
  base_handle text;
  candidate text;
  n int := 0;
begin
  raw_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(coalesce(new.email, 'user'), '@', 1)
  );
  raw_avatar := coalesce(
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'picture'
  );

  base_handle := lower(regexp_replace(
    coalesce(split_part(new.email, '@', 1), 'user'),
    '[^a-z0-9_]', '', 'g'
  ));
  if base_handle is null or char_length(base_handle) < 2 then
    base_handle := 'user';
  end if;
  if char_length(base_handle) > 15 then
    base_handle := substr(base_handle, 1, 15);
  end if;

  candidate := base_handle;
  while exists (select 1 from public.profiles where handle = candidate) loop
    n := n + 1;
    candidate := substr(base_handle, 1, 15) || n::text;
  end loop;

  insert into public.profiles (id, handle, display_name, avatar_url)
  values (new.id, candidate, raw_name, raw_avatar);

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- updated_at helper
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated
before update on public.profiles
for each row execute function public.touch_updated_at();

-- ============================================================
-- POSTS
-- ============================================================
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  background text not null default 'noir',
  image_url text,
  created_at timestamptz not null default now(),
  constraint content_len check (char_length(content) between 1 and 280),
  constraint background_kind check (background in ('noir', 'cream'))
);

create index posts_author_created_idx on public.posts(author_id, created_at desc);
create index posts_created_idx on public.posts(created_at desc);

grant select on public.posts to anon;
grant select, insert, update, delete on public.posts to authenticated;
grant all on public.posts to service_role;

alter table public.posts enable row level security;

create policy "posts are viewable by everyone" on public.posts
for select to anon, authenticated using (true);

create policy "authenticated users can create posts" on public.posts
for insert to authenticated with check (auth.uid() = author_id);

create policy "users can update own posts" on public.posts
for update to authenticated using (auth.uid() = author_id) with check (auth.uid() = author_id);

create policy "users can delete own posts" on public.posts
for delete to authenticated using (auth.uid() = author_id);

-- ============================================================
-- FOLLOWS
-- ============================================================
create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint no_self_follow check (follower_id <> following_id)
);

create index follows_following_idx on public.follows(following_id);

grant select on public.follows to anon;
grant select, insert, delete on public.follows to authenticated;
grant all on public.follows to service_role;

alter table public.follows enable row level security;

create policy "follows are viewable by everyone" on public.follows
for select to anon, authenticated using (true);

create policy "users can follow" on public.follows
for insert to authenticated with check (auth.uid() = follower_id);

create policy "users can unfollow" on public.follows
for delete to authenticated using (auth.uid() = follower_id);

-- ============================================================
-- CONVERSATIONS + MESSAGES
-- ============================================================
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  initiated_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint pair_ordered check (user_a < user_b),
  unique (user_a, user_b)
);

create index conversations_participants_idx on public.conversations(user_a, user_b);

grant select on public.conversations to authenticated;
grant all on public.conversations to service_role;

alter table public.conversations enable row level security;

create policy "participants can view conversation" on public.conversations
for select to authenticated
using (auth.uid() = user_a or auth.uid() = user_b);

-- Inserts happen via server function using service role; no INSERT policy for regular users.

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint body_len check (char_length(body) between 1 and 1000)
);

create index messages_conversation_created_idx on public.messages(conversation_id, created_at);

grant select, insert on public.messages to authenticated;
grant all on public.messages to service_role;

alter table public.messages enable row level security;

create policy "participants can view messages" on public.messages
for select to authenticated
using (exists (
  select 1 from public.conversations c
  where c.id = messages.conversation_id
    and (auth.uid() = c.user_a or auth.uid() = c.user_b)
));

create policy "participants can send messages" on public.messages
for insert to authenticated
with check (
  auth.uid() = sender_id
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and (auth.uid() = c.user_a or auth.uid() = c.user_b)
  )
);

-- Bump conversation.last_message_at on new message
create or replace function public.bump_conversation_activity()
returns trigger
language plpgsql
as $$
begin
  update public.conversations
    set last_message_at = new.created_at
    where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_bump_conversation
after insert on public.messages
for each row execute function public.bump_conversation_activity();

-- ============================================================
-- REPORTS
-- ============================================================
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  constraint reason_len check (reason is null or char_length(reason) <= 500),
  unique (post_id, reporter_id)
);

grant select, insert on public.reports to authenticated;
grant all on public.reports to service_role;

alter table public.reports enable row level security;

create policy "reporters and admins can view reports" on public.reports
for select to authenticated
using (auth.uid() = reporter_id or public.has_role(auth.uid(), 'admin'));

create policy "authenticated users can report" on public.reports
for insert to authenticated
with check (auth.uid() = reporter_id);

-- ============================================================
-- DAILY REQUEST COUNTS
-- ============================================================
create table public.daily_request_counts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  count int not null default 0,
  primary key (user_id, day)
);

grant select on public.daily_request_counts to authenticated;
grant all on public.daily_request_counts to service_role;

alter table public.daily_request_counts enable row level security;

create policy "users can view own counts" on public.daily_request_counts
for select to authenticated using (auth.uid() = user_id);

-- ============================================================
-- REALTIME
-- ============================================================
alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;

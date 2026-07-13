-- ============================================================
-- LEDGER V2: onboarding fields, verification, likes/comments/reposts
-- ============================================================

-- ---- Profile onboarding + verification fields ----
alter table public.profiles
  add column if not exists date_of_birth date,
  add column if not exists role_type text,
  add column if not exists company_name text,
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists verification_tier text not null default 'none';

alter table public.profiles
  add constraint role_type_valid check (
    role_type is null or role_type in ('founder', 'developer', 'pm', 'investor')
  );

alter table public.profiles
  add constraint verification_tier_valid check (
    verification_tier in ('none', 'silver', 'gold')
  );

alter table public.profiles
  add constraint company_name_len check (
    company_name is null or char_length(company_name) <= 80
  );

alter table public.profiles
  add constraint dob_min_age check (
    date_of_birth is null or date_of_birth <= (current_date - interval '13 years')
  );

-- ============================================================
-- VERIFICATION REQUESTS
-- ============================================================
create table public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tier text not null check (tier in ('silver', 'gold')),
  link_primary text not null,
  link_secondary text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint link_primary_len check (char_length(link_primary) between 1 and 300),
  constraint link_secondary_len check (link_secondary is null or char_length(link_secondary) <= 300)
);

create index verification_requests_user_idx on public.verification_requests(user_id, created_at desc);

grant select, insert on public.verification_requests to authenticated;
grant all on public.verification_requests to service_role;

alter table public.verification_requests enable row level security;

create policy "users can view own verification requests" on public.verification_requests
for select to authenticated using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));

create policy "users can apply for verification" on public.verification_requests
for insert to authenticated with check (auth.uid() = user_id);

-- ============================================================
-- LIKES
-- ============================================================
create table public.likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index likes_post_idx on public.likes(post_id);

grant select on public.likes to anon;
grant select, insert, delete on public.likes to authenticated;
grant all on public.likes to service_role;

alter table public.likes enable row level security;

create policy "likes are viewable by everyone" on public.likes
for select to anon, authenticated using (true);

create policy "users can like posts" on public.likes
for insert to authenticated with check (auth.uid() = user_id);

create policy "users can unlike posts" on public.likes
for delete to authenticated using (auth.uid() = user_id);

-- ============================================================
-- REPOSTS
-- ============================================================
create table public.reposts (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index reposts_post_idx on public.reposts(post_id);

grant select on public.reposts to anon;
grant select, insert, delete on public.reposts to authenticated;
grant all on public.reposts to service_role;

alter table public.reposts enable row level security;

create policy "reposts are viewable by everyone" on public.reposts
for select to anon, authenticated using (true);

create policy "users can repost" on public.reposts
for insert to authenticated with check (auth.uid() = user_id);

create policy "users can undo repost" on public.reposts
for delete to authenticated using (auth.uid() = user_id);

-- ============================================================
-- COMMENTS
-- ============================================================
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  constraint comment_content_len check (char_length(content) between 1 and 280)
);

create index comments_post_created_idx on public.comments(post_id, created_at);

grant select on public.comments to anon;
grant select, insert, delete on public.comments to authenticated;
grant all on public.comments to service_role;

alter table public.comments enable row level security;

create policy "comments are viewable by everyone" on public.comments
for select to anon, authenticated using (true);

create policy "authenticated users can comment" on public.comments
for insert to authenticated with check (auth.uid() = author_id);

create policy "users can delete own comments" on public.comments
for delete to authenticated using (auth.uid() = author_id);

-- ============================================================
-- REALTIME
-- ============================================================
alter publication supabase_realtime add table public.likes;
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.reposts;
alter publication supabase_realtime add table public.profiles;

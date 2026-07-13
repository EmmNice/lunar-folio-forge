-- ============================================================
-- THE LEDGER — MANUAL SETUP SCRIPT
-- Run this ONCE in: Supabase Dashboard (project hfiiirbhbuksfmgjlpkl) →
-- SQL Editor → New query → paste this whole file → Run.
-- It adds the new onboarding/verification/social schema and seeds four
-- demo "Verified Tech Founder" accounts + posts so the feed looks alive
-- from the first load. Safe to run once on a fresh project.
-- ============================================================

-- ---- Profile onboarding + verification fields ----
alter table public.profiles
  add column if not exists date_of_birth date,
  add column if not exists role_type text,
  add column if not exists company_name text,
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists verification_tier text not null default 'none',
  add column if not exists github_url text,
  add column if not exists portfolio_url text,
  add column if not exists startup_url text,
  add column if not exists traction_url text;

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
  add constraint github_url_len check (github_url is null or char_length(github_url) <= 300);
alter table public.profiles
  add constraint portfolio_url_len check (portfolio_url is null or char_length(portfolio_url) <= 300);
alter table public.profiles
  add constraint startup_url_len check (startup_url is null or char_length(startup_url) <= 300);
alter table public.profiles
  add constraint traction_url_len check (traction_url is null or char_length(traction_url) <= 300);

alter table public.profiles
  add constraint dob_min_age check (
    date_of_birth is null or date_of_birth <= (current_date - interval '13 years')
  );

-- ============================================================
-- REMOVE FOLLOW/FOLLOWING SYSTEM
-- The Ledger is a high-signal professional network, not a social graph:
-- the Explore Feed is a single global chronological timeline visible to
-- everyone, and profile pages link out via "Connect" (GitHub / startup
-- URL) instead of a follow relationship.
-- ============================================================
drop table if exists public.follows cascade;

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
for select to authenticated using (auth.uid() = user_id);

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

-- (reports table already exists from the base schema — reused as-is by the feed's report action)

-- ============================================================
-- REALTIME
-- ============================================================
alter publication supabase_realtime add table public.likes;
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.reposts;
alter publication supabase_realtime add table public.profiles;

-- ============================================================
-- SEED: 4 demo "Verified Tech Founder" accounts + posts
-- (safe to skip/comment out if you don't want demo content)
-- ============================================================
create extension if not exists pgcrypto;

do $$
declare
  f1 uuid; f2 uuid; f3 uuid; f4 uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'aria.stone@ledger.seed', crypt('LedgerSeed!1', gen_salt('bf')), now(), '{"provider":"seed"}', '{}', now(), now(), '', '', '', '')
  returning id into f1;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'malik.chen@ledger.seed', crypt('LedgerSeed!1', gen_salt('bf')), now(), '{"provider":"seed"}', '{}', now(), now(), '', '', '', '')
  returning id into f2;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'priya.nataraj@ledger.seed', crypt('LedgerSeed!1', gen_salt('bf')), now(), '{"provider":"seed"}', '{}', now(), now(), '', '', '', '')
  returning id into f3;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'dev.okafor@ledger.seed', crypt('LedgerSeed!1', gen_salt('bf')), now(), '{"provider":"seed"}', '{}', now(), now(), '', '', '', '')
  returning id into f4;

  -- handle_new_user() trigger already created a profiles row per user; fill it in.
  update public.profiles set
    handle = 'ariastone', display_name = 'Aria Stone', bio = 'Building the boring infra everyone depends on.',
    company_name = 'Nimbus Cloud', role_type = 'founder', onboarding_completed = true,
    verification_tier = 'gold', startup_url = 'https://nimbuscloud.io', traction_url = 'https://nimbuscloud.io/metrics'
  where id = f1;

  update public.profiles set
    handle = 'malikchen', display_name = 'Malik Chen', bio = 'Core dev. I ship the parts nobody sees until they break.',
    company_name = 'Vector Labs', role_type = 'developer', onboarding_completed = true,
    verification_tier = 'silver', github_url = 'https://github.com/malikchen', portfolio_url = 'https://malikchen.dev'
  where id = f2;

  update public.profiles set
    handle = 'priyanataraj', display_name = 'Priya Nataraj', bio = 'Founder, FlowState AI. Ex-founder, twice acquired.',
    company_name = 'FlowState AI', role_type = 'founder', onboarding_completed = true,
    verification_tier = 'gold', startup_url = 'https://flowstate.ai', traction_url = 'https://flowstate.ai/press'
  where id = f3;

  update public.profiles set
    handle = 'devokafor', display_name = 'Dev Okafor', bio = 'Technical PM turning founder chaos into shipped roadmaps.',
    company_name = 'Ridgeline Systems', role_type = 'pm', onboarding_completed = true,
    verification_tier = 'silver', github_url = 'https://github.com/devokafor', portfolio_url = 'https://devokafor.com'
  where id = f4;

  insert into public.posts (author_id, content, background, created_at) values
    (f1, 'Just shipped our v2 architecture migration — moved 40k tenants off a single Postgres instance to per-region shards with zero downtime. The runbook alone was 90 pages. Boring infra work is still the best infra work.', 'noir', now() - interval '3 hours')
  returning id into p1;

  insert into public.posts (author_id, content, background, created_at) values
    (f2, 'Hot take: your seed round deck should fit on 8 slides. If you need 20 to explain the business, the business isn''t clear yet — the deck is doing the founder''s job for them.', 'cream', now() - interval '7 hours')
  returning id into p2;

  insert into public.posts (author_id, content, background, created_at) values
    (f3, 'We just crossed $1M ARR with a 2-person eng team. Not a flex — a warning. We''re one incident away from a very bad week. Hiring our first SRE this quarter.', 'noir', now() - interval '1 day')
  returning id into p3;

  insert into public.posts (author_id, content, background, created_at) values
    (f4, 'Spent the weekend rewriting our onboarding flow after watching 30 user session recordings. Nobody reads the empty-state copy — they just click the biggest button. Ship the button, skip the copy.', 'cream', now() - interval '1 day 4 hours')
  returning id into p4;

  insert into public.likes (post_id, user_id) values
    (p1, f2), (p1, f3), (p1, f4),
    (p2, f1), (p2, f3),
    (p3, f1), (p3, f2), (p3, f4),
    (p4, f1);

  insert into public.comments (post_id, author_id, content, created_at) values
    (p1, f3, 'Zero-downtime shard migration at that scale is no joke. What did you use for the cutover — dual writes or CDC?', now() - interval '2 hours'),
    (p3, f2, 'This is the real talk more "we hit $1M ARR" posts need. Congrats on the milestone AND the honesty.', now() - interval '20 hours');
end $$;

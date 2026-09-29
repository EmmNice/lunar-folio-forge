#!/usr/bin/env bash
# Applies every migration in order to a throwaway Postgres, then asserts that the
# objects and — more importantly — the *policies* the migrations are supposed to
# create actually behave as intended.
#
# This is the security model's regression test. Most of the assertions below are
# negative ones: that `authenticated` CANNOT write a privileged column, CANNOT read
# somebody else's private data, CANNOT execute a definer function. Those are
# exactly the properties a later migration can silently undo, which is why they run
# in CI rather than by hand.
#
# Two ways to run it:
#
#   DATABASE_URL=postgres://...  ./scripts/validate-migrations.sh
#       Uses an existing empty Postgres. This is the CI path — see
#       .github/workflows/ci.yml, which provides one as a service container.
#
#   ./scripts/validate-migrations.sh
#       Manages its own throwaway container via Docker. The local path.
#
# The database is left in a dirty state afterwards either way; it must be empty at
# the start, so never point DATABASE_URL at anything you care about.
set -u

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf "  \033[32mPASS\033[0m  %s\n" "$1"; }
bad() { FAIL=$((FAIL+1)); printf "  \033[31mFAIL\033[0m  %s\n" "$1"; [ -n "${2:-}" ] && printf "          %s\n" "$2"; }

if [ -n "${DATABASE_URL:-}" ]; then
  PSQL() { psql "$DATABASE_URL" "$@"; }
  for i in $(seq 1 60); do PSQL -tAc 'select 1' >/dev/null 2>&1 && break; sleep 1; done
  PSQL -tAc 'select 1' >/dev/null 2>&1 || { echo "ABORT: cannot reach DATABASE_URL"; exit 90; }
else
  command -v docker >/dev/null 2>&1 || { echo "ABORT: need Docker, or set DATABASE_URL"; exit 90; }
  PG=migtest
  docker rm -f "$PG" >/dev/null 2>&1
  # PGDATA on a tmpfs: initdb's final "syncing data to disk" takes minutes on some
  # storage backends, which looks indistinguishable from Postgres never starting.
  docker create --name "$PG" -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=ledger \
    -e PGDATA=/tmp/pgdata --tmpfs /tmp:rw,size=1g postgres:16-alpine >/dev/null 2>&1
  docker start "$PG" >/dev/null 2>&1
  PSQL() { docker exec -i "$PG" psql -U postgres -d ledger "$@"; }
  for i in $(seq 1 60); do docker exec "$PG" pg_isready -U postgres -d ledger >/dev/null 2>&1 && break; sleep 1; done
  docker exec "$PG" pg_isready -U postgres -d ledger >/dev/null 2>&1 || { echo "ABORT: postgres not ready"; exit 90; }
fi

q()  { PSQL -q "$@"; }
qt() { PSQL -tAc "$1" 2>/dev/null | tr -d ' '; }

# ------------------------------------------------------------- supabase shims
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
create schema if not exists auth; create schema if not exists storage;
create table auth.users (id uuid primary key, email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
-- Null-safe: current_setting returns '' when unset, and ''::jsonb is an error
-- rather than an absent claim. Cast only after nulling the empty string.
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $fn$;
create or replace function auth.role() returns text language sql stable as $fn$
  select coalesce(nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''), 'anon') $fn$;
create table storage.buckets (id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, owner uuid);
create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $fn$ select string_to_array(name,'/') $fn$;
do $b$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end $b$;
grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create publication supabase_realtime;
SQL
[ "$(qt 'select 1')" = "1" ] || { echo "ABORT: shims failed"; exit 90; }

# ------------------------------------------------------------- run migrations
echo
echo "Applying migrations"

# Abort rather than "pass" against an empty schema. Without this, being in the
# wrong directory produces a wall of assertion failures that look like broken
# policies instead of a broken invocation — which is exactly how this was first
# noticed, running the script from outside the repo.
MIGRATION_COUNT=$(ls supabase/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
[ "$MIGRATION_COUNT" -gt 0 ] || {
  echo "ABORT: no migrations found in $(pwd)/supabase/migrations"
  exit 90
}
echo "  $MIGRATION_COUNT migration files"

for f in $(ls supabase/migrations/*.sql | sort); do
  # NOTICE lines land on stderr too ("constraint ... does not exist, skipping"
  # from every idempotent DROP IF EXISTS), so only ERROR counts as a failure.
  err=$(q -v ON_ERROR_STOP=1 < "$f" 2>&1 >/dev/null | grep -E '^(ERROR|FATAL|PANIC)' | head -3)
  if [ -n "$err" ]; then
    bad "$(basename "$f")" "$(echo "$err" | tr '\n' ' ')"
  else
    ok "$(basename "$f")"
  fi
done

# Hosted Supabase grants table privileges to anon/authenticated as tables are
# created; replicate that, then re-assert the column-level privacy migration so
# the blanket grant cannot mask it (production applied them in that same order).
q >/dev/null 2>&1 <<'SQL'
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
SQL
# Re-run the whole set, in order. Re-applying only a couple of files let an
# earlier migration's constraint or grant win over a later one's: the
# notifications type check lost 'follow' and the billing tables looked writable
# by `authenticated`, both of which were then reported as product bugs.
for f in $(ls supabase/migrations/*.sql | sort); do
  q -v ON_ERROR_STOP=1 < "$f" >/dev/null 2>&1
done

# ------------------------------------------------------------- object asserts
echo
echo "Schema assertions"

chk() { # name | expected | sql
  got=$(qt "$3")
  if [ "$got" = "$2" ]; then ok "$1"; else bad "$1" "expected '$2' got '$got'"; fi
}

# Passes only if the statement RAISES. qt swallows stderr and returns empty on
# error, which is indistinguishable from a statement that legitimately returned
# nothing -- so this checks psql's exit status instead.
chk_err() { # name | sql
  if PSQL -tA -v ON_ERROR_STOP=1 -c "$2" >/dev/null 2>&1; then
    bad "$1" "expected the statement to be rejected, but it succeeded"
  else
    ok "$1"
  fi
}

chk "profiles.account_status exists" "t" \
  "select exists(select 1 from information_schema.columns where table_name='profiles' and column_name='account_status')"
chk "only one privileged-column trigger on profiles" "1" \
  "select count(*) from pg_trigger where tgrelid='public.profiles'::regclass and tgname like '%guard_privileged%'"
chk "guard_profile_privileged_columns is gone" "f" \
  "select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='guard_profile_privileged_columns')"

chk "anon cannot select date_of_birth" "f" \
  "select has_column_privilege('anon','public.profiles','date_of_birth','SELECT')"
chk "anon cannot select subscription_status" "f" \
  "select has_column_privilege('anon','public.profiles','subscription_status','SELECT')"
chk "anon cannot select account_status" "f" \
  "select has_column_privilege('anon','public.profiles','account_status','SELECT')"
chk "anon cannot select notification_prefs" "f" \
  "select has_column_privilege('anon','public.profiles','notification_prefs','SELECT')"
chk "authenticated cannot select date_of_birth" "f" \
  "select has_column_privilege('authenticated','public.profiles','date_of_birth','SELECT')"
chk "authenticated cannot select ai_credits_used" "f" \
  "select has_column_privilege('authenticated','public.profiles','ai_credits_used','SELECT')"
chk "anon CAN still select handle" "t" \
  "select has_column_privilege('anon','public.profiles','handle','SELECT')"
chk "anon CAN still select verification_tier" "t" \
  "select has_column_privilege('anon','public.profiles','verification_tier','SELECT')"
chk "authenticated can execute current_profile()" "t" \
  "select has_function_privilege('authenticated','public.current_profile()','EXECUTE')"
chk "anon cannot execute current_profile()" "f" \
  "select has_function_privilege('anon','public.current_profile()','EXECUTE')"

chk "background CHECK allows all 7 themes" "t" \
  "select pg_get_constraintdef(oid) like '%midnight%' from pg_constraint where conname='background_kind'"
chk "posts.visibility has a CHECK" "t" \
  "select exists(select 1 from pg_constraint where conname='posts_visibility_valid')"
chk "posts SELECT policy is audience-aware" "t" \
  "select qual like '%can_view_post%' from pg_policies where tablename='posts' and cmd='SELECT'"
chk "posts INSERT enforces publish entitlement" "t" \
  "select bool_or(with_check like '%can_publish_to%') from pg_policies where tablename='posts' and cmd='INSERT'"
chk "comments INSERT enforces comments_enabled" "t" \
  "select bool_or(with_check like '%post_accepts_comments%') from pg_policies where tablename='comments' and cmd='INSERT'"
chk "reposts INSERT blocks self-repost" "t" \
  "select bool_or(with_check like '%author_id = auth.uid()%') from pg_policies where tablename='reposts' and cmd='INSERT'"
chk "messages INSERT requires active account" "t" \
  "select bool_or(with_check like '%actor_is_active%') from pg_policies where tablename='messages' and cmd='INSERT'"
chk "likes INSERT requires active account" "t" \
  "select bool_or(with_check like '%actor_is_active%') from pg_policies where tablename='likes' and cmd='INSERT'"

chk "reports.status exists" "t" \
  "select exists(select 1 from information_schema.columns where table_name='reports' and column_name='status')"
chk "admins can resolve reports" "t" \
  "select exists(select 1 from pg_policies where tablename='reports' and cmd='UPDATE' and with_check like '%is_admin%')"
chk "admin_actions table exists with RLS" "t" \
  "select relrowsecurity from pg_class where oid='public.admin_actions'::regclass"
chk "admin_actions has no INSERT policy" "0" \
  "select count(*) from pg_policies where tablename='admin_actions' and cmd='INSERT'"
chk "authenticated cannot insert admin_actions" "f" \
  "select has_table_privilege('authenticated','public.admin_actions','INSERT')"
chk "admins can delete any post" "t" \
  "select exists(select 1 from pg_policies where tablename='posts' and cmd='DELETE' and qual like '%is_admin%')"
chk "pitches.status has a CHECK" "t" \
  "select exists(select 1 from pg_constraint where conname='pitches_status_valid')"

# Removing a reported post used to cascade the report away, destroying the reason,
# the reviewer and the resolution note -- on exactly the action a moderator took.
chk "reports.post_id is nullable" "YES" \
  "select is_nullable from information_schema.columns where table_schema='public' and table_name='reports' and column_name='post_id'"
chk "removing a post does NOT cascade-delete its report" "t" \
  "select pg_get_constraintdef(oid) like '%ON DELETE SET NULL%' from pg_constraint where conname='reports_post_id_fkey'"
chk "pitches policies are scoped to authenticated" "t" \
  "select bool_and(roles::text = '{authenticated}') from pg_policies where tablename='pitches'"
chk "pitch immutability trigger installed" "t" \
  "select exists(select 1 from pg_trigger where tgrelid='public.pitches'::regclass and tgname='pitches_guard_immutable')"
chk "notifications accepts type=message" "t" \
  "select pg_get_constraintdef(oid) like '%message%' from pg_constraint where conname='notifications_type_check'"
chk "message notification trigger installed" "t" \
  "select exists(select 1 from pg_trigger where tgrelid='public.messages'::regclass and tgname='trg_notify_message')"
chk "profiles url scheme CHECK present" "t" \
  "select exists(select 1 from pg_constraint where conname='profiles_github_url_scheme')"
chk "pitches deck_url scheme CHECK present" "t" \
  "select exists(select 1 from pg_constraint where conname='pitches_deck_url_scheme')"

echo
echo "Behavioural assertions (as authenticated, via SET LOCAL ROLE)"

# Seed two members and a post. Runs as postgres, which bypasses RLS.
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','member@example.com'),
  ('22222222-2222-2222-2222-222222222222','gold@example.com'),
  ('33333333-3333-3333-3333-333333333333','banned@example.com')
on conflict do nothing;
insert into public.profiles (id, handle, display_name, onboarding_completed, verification_tier, account_status)
values
  ('11111111-1111-1111-1111-111111111111','member','Member',true,'none','active'),
  ('22222222-2222-2222-2222-222222222222','goldie','Goldie',true,'gold','active'),
  ('33333333-3333-3333-3333-333333333333','badguy','Bad Guy',true,'none','banned')
on conflict (id) do update set
  handle = excluded.handle,
  display_name = excluded.display_name,
  account_status = excluded.account_status,
  verification_tier = excluded.verification_tier,
  onboarding_completed = true;
insert into public.posts (id, author_id, content, background, visibility) values
  ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','whisper post','noir','whisper'),
  ('aaaaaaaa-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','verified post','noir','verified_only'),
  ('aaaaaaaa-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','public post','gold','public'),
  ('aaaaaaaa-0000-0000-0000-000000000004','33333333-3333-3333-3333-333333333333','banned post','noir','public')
on conflict (id) do nothing;
SQL

# asb <name> <expected|ERROR> <uid> <sql>
#
# \o /dev/null hides the BEGIN/SET/set_config/ROLLBACK chatter so only the
# statement under test reaches stdout. Errors go to stderr, which \o does not
# redirect, so a denied statement still shows up. An earlier version of this
# helper took `tail -1` and therefore compared every result against the string
# "ROLLBACK", which made all 18 behavioural checks fail for no reason.
asb() {
  got=$(PSQL -tA -v ON_ERROR_STOP=0 <<SQL 2>&1
\o /dev/null
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$3","role":"authenticated"}', true);
\o
$4
\o /dev/null
rollback;
SQL
)
  # Keep only the LAST value. An assertion often needs a setup statement first,
  # and joining every line turned '0' into 'INSERT01|0'.
  got_full=$(echo "$got" | grep -v '^$' | tr -d ' ' | tr '\n' '|' | sed 's/|$//')
  got=$(echo "$got" | grep -v '^$' | tr -d ' ' | tail -1)
  if [ "$2" = "ERROR" ]; then
    case "$got_full" in
      *ERROR*) ok "$1" ;;
      *) bad "$1" "expected an error, got '$got_full'" ;;
    esac
  elif [ "$got" = "$2" ]; then
    ok "$1"
  else
    bad "$1" "expected '$2' got '$got'"
  fi
}

asb "gold member sees the whisper post" "1" "22222222-2222-2222-2222-222222222222" \
  "select count(*) from public.posts where id='aaaaaaaa-0000-0000-0000-000000000001';"
asb "unverified member cannot see the whisper post" "0" "11111111-1111-1111-1111-111111111111" \
  "select count(*) from public.posts where id='aaaaaaaa-0000-0000-0000-000000000001';"
asb "unverified member cannot see the verified_only post" "0" "11111111-1111-1111-1111-111111111111" \
  "select count(*) from public.posts where id='aaaaaaaa-0000-0000-0000-000000000002';"
asb "everyone sees the public post" "1" "11111111-1111-1111-1111-111111111111" \
  "select count(*) from public.posts where id='aaaaaaaa-0000-0000-0000-000000000003';"
asb "banned member's post is hidden from others" "0" "11111111-1111-1111-1111-111111111111" \
  "select count(*) from public.posts where id='aaaaaaaa-0000-0000-0000-000000000004';"
asb "banned member still sees their own post" "1" "33333333-3333-3333-3333-333333333333" \
  "select count(*) from public.posts where id='aaaaaaaa-0000-0000-0000-000000000004';"
asb "reading another member's DOB is denied" "ERROR" "11111111-1111-1111-1111-111111111111" \
  "select coalesce((select 'x' from public.profiles where date_of_birth is not null limit 1),'none');"
asb "unverified member cannot publish whisper" "ERROR" "11111111-1111-1111-1111-111111111111" \
  "insert into public.posts (author_id, content, visibility) values ('11111111-1111-1111-1111-111111111111','nope','whisper');"
asb "member can publish public" "INSERT01" "11111111-1111-1111-1111-111111111111" \
  "insert into public.posts (author_id, content, visibility) values ('11111111-1111-1111-1111-111111111111','fine','public');"
asb "banned member cannot post" "ERROR" "33333333-3333-3333-3333-333333333333" \
  "insert into public.posts (author_id, content) values ('33333333-3333-3333-3333-333333333333','still here');"
asb "member cannot unban themselves" "ERROR" "33333333-3333-3333-3333-333333333333" \
  "update public.profiles set account_status='active' where id='33333333-3333-3333-3333-333333333333';"
# The handle used to be frozen forever after onboarding. 20260930000100 made it
# changeable on a 30-day cooldown, because most handles had been generated from an
# email address nobody was asked about — the old rule made a bad identity permanent.
asb "member CAN rename their handle once" "1" "11111111-1111-1111-1111-111111111111" \
  "update public.profiles set handle='renamed_once' where id='11111111-1111-1111-1111-111111111111';
   select count(*) from public.profiles where handle='renamed_once';"
# The rename above is rolled back by asb, so stamp the cooldown as postgres to test
# the second-change path.
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
update public.profiles set handle_changed_at = now() - interval '3 days'
 where id='11111111-1111-1111-1111-111111111111';
SQL
asb "a second rename inside 30 days is refused" "ERROR" "11111111-1111-1111-1111-111111111111" \
  "update public.profiles set handle='too_soon' where id='11111111-1111-1111-1111-111111111111';"
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
update public.profiles set handle_changed_at = now() - interval '45 days'
 where id='11111111-1111-1111-1111-111111111111';
SQL
asb "a rename after the cooldown is allowed" "1" "11111111-1111-1111-1111-111111111111" \
  "update public.profiles set handle='after_cooldown' where id='11111111-1111-1111-1111-111111111111';
   select count(*) from public.profiles where handle='after_cooldown';"
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
update public.profiles set handle_changed_at = null
 where id='11111111-1111-1111-1111-111111111111';
SQL
asb "a reserved username is refused" "ERROR" "11111111-1111-1111-1111-111111111111" \
  "update public.profiles set handle='admin' where id='11111111-1111-1111-1111-111111111111';"
asb "another reserved username is refused" "ERROR" "11111111-1111-1111-1111-111111111111" \
  "update public.profiles set handle='support' where id='11111111-1111-1111-1111-111111111111';"
# Case folding is what makes uniqueness case-insensitive: an uppercase handle is
# normalised rather than stored as a second distinct identity.
asb "an uppercase username is folded to lowercase" "godson" "11111111-1111-1111-1111-111111111111" \
  "update public.profiles set handle='GODSON' where id='11111111-1111-1111-1111-111111111111';
   select handle from public.profiles where id='11111111-1111-1111-1111-111111111111';"
asb "a username colliding case-insensitively is refused" "ERROR" "11111111-1111-1111-1111-111111111111" \
  "update public.profiles set handle='GOLDIE' where id='11111111-1111-1111-1111-111111111111';"
asb "a malformed username is refused" "ERROR" "11111111-1111-1111-1111-111111111111" \
  "update public.profiles set handle='no.dots' where id='11111111-1111-1111-1111-111111111111';"
asb "member still cannot reopen onboarding for a free rename" "ERROR" "11111111-1111-1111-1111-111111111111" \
  "update public.profiles set onboarding_completed=false where id='11111111-1111-1111-1111-111111111111';"

# ── username_available(), the signup-time check ─────────────────────────────
chk "username_available says taken for an existing handle" "false" \
  "select (public.username_available('goldie')->>'available')"
chk "username_available says taken is the reason" "taken" \
  "select (public.username_available('goldie')->>'reason')"
chk "username_available is case-insensitive about taken names" "false" \
  "select (public.username_available('GOLDIE')->>'available')"
chk "username_available allows a free name" "true" \
  "select (public.username_available('brand_new_dev')->>'available')"
chk "username_available rejects reserved names" "reserved" \
  "select (public.username_available('admin')->>'reason')"
chk "username_available rejects malformed names" "invalid" \
  "select (public.username_available('a')->>'reason')"
chk "username_available is callable by anon" "t" \
  "select has_function_privilege('anon', 'public.username_available(text)', 'execute')"

# ── new signups must not inherit their identity from their email ────────────
# Signup identity. The inserts are done with `q` and the assertions with `chk`,
# separately and deliberately: qt() does not strip psql's "INSERT 0 1" status line,
# so a multi-statement chk compares against "INSERT01<newline>value" and fails for
# reasons that have nothing to do with the schema.
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'someone@example.com',        '{"username":"chosen_name"}'::jsonb),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'firstname.lastname@corp.com','{"username":"dev_identity"}'::jsonb),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'oauthperson@example.com',    '{}'::jsonb);
SQL

# A signup that supplies a username gets exactly that username -- not a suffixed
# variant, which is how most implementations quietly hand over a different identity.
chk "signup with a username uses it verbatim" "chosen_name" \
  "select handle from public.profiles where id='aaaaaaaa-0000-4000-8000-000000000001'"

# display_name must not fall back to the email local part. This is the disclosure
# that motivated the migration: 'firstname.lastname' would have become a public name.
chk "signup display_name is not the email local part" "t" \
  "select display_name <> 'firstname.lastname' from public.profiles where id='aaaaaaaa-0000-4000-8000-000000000002'"
chk "signup display_name falls back to the username" "dev_identity" \
  "select display_name from public.profiles where id='aaaaaaaa-0000-4000-8000-000000000002'"

# OAuth cannot supply a username at account-creation time. The placeholder must be
# neutral rather than email-derived, so abandoning onboarding discloses nothing.
chk "oauth signup gets a neutral placeholder handle" "t" \
  "select handle like 'dev\\_%' from public.profiles where id='aaaaaaaa-0000-4000-8000-000000000003'"
chk "oauth placeholder is not derived from the email" "f" \
  "select handle like '%oauthperson%' from public.profiles where id='aaaaaaaa-0000-4000-8000-000000000003'"
chk "oauth display_name is not the email local part either" "f" \
  "select display_name = 'oauthperson' from public.profiles where id='aaaaaaaa-0000-4000-8000-000000000003'"

# A taken username must abort the signup rather than silently suffix a digit.
# The trigger runs inside the auth.users insert, so raising rolls that insert back
# too -- which is why the second assertion can prove no half-named account survives.
chk_err "signup with a taken username is rejected" \
  "insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'dupe@example.com', '{\"username\":\"goldie\"}'::jsonb)"
chk "the rejected signup left no auth row behind" "0" \
  "select count(*) from auth.users where email='dupe@example.com'"
chk_err "signup with a reserved username is rejected" \
  "insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'res@example.com', '{\"username\":\"admin\"}'::jsonb)"
chk_err "signup with a malformed username is rejected" \
  "insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'bad@example.com', '{\"username\":\"x\"}'::jsonb)"
asb "member cannot store a javascript: url" "ERROR" "11111111-1111-1111-1111-111111111111" \
  "update public.profiles set github_url='javascript:alert(1)' where id='11111111-1111-1111-1111-111111111111';"
asb "member cannot self-repost" "ERROR" "22222222-2222-2222-2222-222222222222" \
  "insert into public.reposts (post_id, user_id) values ('aaaaaaaa-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222');"
asb "member can repost someone else" "INSERT01" "11111111-1111-1111-1111-111111111111" \
  "insert into public.reposts (post_id, user_id) values ('aaaaaaaa-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111');"
asb "current_profile() returns own row" "member" "11111111-1111-1111-1111-111111111111" \
  "select (public.current_profile()).handle;"
asb "current_profile() exposes own private column" "t" "11111111-1111-1111-1111-111111111111" \
  "select (public.current_profile()).account_status = 'active';"
asb "non-admin cannot read the audit log" "0" "11111111-1111-1111-1111-111111111111" \
  "select count(*) from public.admin_actions;"

echo
printf "Schema/behaviour subtotal: \033[32m%d passed\033[0m, \033[31m%d failed\033[0m\n" "$PASS" "$FAIL"
# Deliberately no `exit` here. This used to be the script's only exit gate, which
# meant the whole social-graph/search/billing section below — appended later — could
# fail while the script still exited 0. The single gate is now at the very end.


echo
echo "Social graph, safety, threading, editing, search, billing"

MEMBER=11111111-1111-1111-1111-111111111111
GOLD=22222222-2222-2222-2222-222222222222
BANNED=33333333-3333-3333-3333-333333333333

# ── schema presence ─────────────────────────────────────────────────────────
chk "follows table exists" "t" \
  "select exists(select 1 from information_schema.tables where table_name='follows' and table_schema='public')"
chk "blocks table exists" "t" \
  "select exists(select 1 from information_schema.tables where table_name='blocks' and table_schema='public')"
chk "mutes table exists" "t" \
  "select exists(select 1 from information_schema.tables where table_name='mutes' and table_schema='public')"
chk "self-follow is impossible" "t" \
  "select exists(select 1 from pg_constraint where conname='no_self_follow')"
chk "comments.parent_id exists" "t" \
  "select exists(select 1 from information_schema.columns where table_name='comments' and column_name='parent_id')"
chk "posts.edited_at exists" "t" \
  "select exists(select 1 from information_schema.columns where table_name='posts' and column_name='edited_at')"
chk "posts search index exists" "t" \
  "select exists(select 1 from pg_indexes where indexname='posts_search_idx')"
chk "profiles search index exists" "t" \
  "select exists(select 1 from pg_indexes where indexname='profiles_search_idx')"
chk "billing_subscriptions exists with RLS" "t" \
  "select relrowsecurity from pg_class where oid='public.billing_subscriptions'::regclass"
chk "notifications accepts type=follow" "t" \
  "select pg_get_constraintdef(oid) like '%follow%' from pg_constraint where conname='notifications_type_check'"

# ── nobody writes billing from a browser ────────────────────────────────────
chk "authenticated cannot insert billing_subscriptions" "f" \
  "select has_table_privilege('authenticated','public.billing_subscriptions','INSERT')"
chk "authenticated cannot update billing_subscriptions" "f" \
  "select has_table_privilege('authenticated','public.billing_subscriptions','UPDATE')"
chk "authenticated cannot insert billing_events" "f" \
  "select has_table_privilege('authenticated','public.billing_events','INSERT')"
chk "sync_subscription_status is service_role only" "f" \
  "select has_function_privilege('authenticated','public.sync_subscription_status(uuid)','EXECUTE')"

# ── search must not leak private columns ────────────────────────────────────
# A SECURITY DEFINER function returning `setof profiles` would hand back every
# column as the owner, bypassing the column grants. Assert the signature instead
# of trusting the comment.
chk "search_profiles does not return date_of_birth" "f" \
  "select pg_get_function_result(p.oid) like '%date_of_birth%' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='search_profiles'"
chk "search_profiles does not return subscription_status" "f" \
  "select pg_get_function_result(p.oid) like '%subscription_status%' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='search_profiles'"
chk "search_profiles is callable by anon" "t" \
  "select has_function_privilege('anon','public.search_profiles(text,integer)','EXECUTE')"

# ── behaviour ───────────────────────────────────────────────────────────────
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
update public.profiles set account_status='active' where id='$BANNED';
insert into public.posts (id, author_id, content, visibility) values
  ('bbbb0000-0000-4000-8000-000000000001','$GOLD','gold public post','public')
on conflict (id) do nothing;
insert into public.comments (id, post_id, author_id, content)
values ('cccc0000-0000-4000-8000-000000000001','bbbb0000-0000-4000-8000-000000000001','$GOLD','top level')
on conflict (id) do nothing;
insert into public.comments (id, post_id, author_id, content, parent_id)
values ('cccc0000-0000-4000-8000-000000000002','bbbb0000-0000-4000-8000-000000000001','$MEMBER','first reply','cccc0000-0000-4000-8000-000000000001')
on conflict (id) do nothing;
SQL

asb "member can follow another member" "INSERT01" "$MEMBER" \
  "insert into public.follows (follower_id, following_id) values ('$MEMBER','$GOLD');"
asb "member cannot follow themselves" "ERROR" "$MEMBER" \
  "insert into public.follows (follower_id, following_id) values ('$MEMBER','$MEMBER');"
asb "member cannot forge a follow for someone else" "ERROR" "$MEMBER" \
  "insert into public.follows (follower_id, following_id) values ('$GOLD','$MEMBER');"

asb "a reply two levels deep is allowed" "INSERT01" "$MEMBER" \
  "insert into public.comments (post_id, author_id, content, parent_id) values ('bbbb0000-0000-4000-8000-000000000001','$MEMBER','reply to reply','cccc0000-0000-4000-8000-000000000002');"
asb "a reply cannot be grafted onto a different post" "ERROR" "$MEMBER" \
  "insert into public.comments (post_id, author_id, content, parent_id) values ('aaaaaaaa-0000-0000-0000-000000000003','$MEMBER','wrong post','cccc0000-0000-4000-8000-000000000001');"
asb "comments cannot be edited or reparented at all (no UPDATE policy)" "UPDATE0" "$MEMBER" \
  "update public.comments set parent_id=null where id='cccc0000-0000-4000-8000-000000000002';"

asb "author can edit their own post" "UPDATE1" "$GOLD" \
  "update public.posts set content='gold public post, edited' where id='bbbb0000-0000-4000-8000-000000000001';"
asb "editing stamps edited_at" "t" "$GOLD" \
  "update public.posts set content='edited again' where id='bbbb0000-0000-4000-8000-000000000001'; select edited_at is not null from public.posts where id='bbbb0000-0000-4000-8000-000000000001';"
asb "a post cannot be backdated" "ERROR" "$GOLD" \
  "update public.posts set created_at=now() - interval '10 days' where id='bbbb0000-0000-4000-8000-000000000001';"
asb "a post cannot be reattributed" "ERROR" "$GOLD" \
  "update public.posts set author_id='$MEMBER' where id='bbbb0000-0000-4000-8000-000000000001';"
asb "a member cannot edit someone else's post" "UPDATE0" "$MEMBER" \
  "update public.posts set content='hijacked' where id='bbbb0000-0000-4000-8000-000000000001';"

# Blocks are symmetric and hide content in both directions.
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
insert into public.blocks (blocker_id, blocked_id) values ('$MEMBER','$GOLD') on conflict do nothing;
SQL
asb "blocked member cannot see the blocker's post" "0" "$MEMBER" \
  "select count(*) from public.posts where id='bbbb0000-0000-4000-8000-000000000001';"
asb "blocker cannot see the blocked member's comments" "0" "$MEMBER" \
  "select count(*) from public.comments where author_id='$GOLD';"
asb "a block prevents a new follow" "ERROR" "$MEMBER" \
  "insert into public.follows (follower_id, following_id) values ('$MEMBER','$GOLD');"
asb "the blocked side also loses sight of the blocker" "0" "$GOLD" \
  "select count(*) from public.posts where author_id='$MEMBER' and visibility='public';"
asb "block list is private to its owner" "0" "$GOLD" \
  "select count(*) from public.blocks;"

# A mute is a preference, not a boundary: it must NOT hide the profile or posts at
# the RLS layer, or it would just be a block with a friendlier name.
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
delete from public.blocks where blocker_id='$MEMBER' and blocked_id='$GOLD';
insert into public.mutes (muter_id, muted_id) values ('$MEMBER','$GOLD') on conflict do nothing;
SQL
asb "a mute does not hide posts at the RLS layer" "1" "$MEMBER" \
  "select count(*) from public.posts where id='bbbb0000-0000-4000-8000-000000000001';"
asb "mute list is private to its owner" "0" "$GOLD" \
  "select count(*) from public.mutes;"

asb "search finds a member by handle" "1" "$MEMBER" \
  "select count(*) from public.search_profiles('goldie', 10);"
# Seeded as postgres: a member cannot set another member's privacy flag, so doing
# it inside the authenticated transaction updated nothing and the assertion was
# measuring the default.
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
update public.profiles set hide_from_search = true where id='$GOLD';
SQL
asb "search respects hide_from_search" "0" "$MEMBER" \
  "select count(*) from public.search_profiles('goldie', 10);"
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
update public.profiles set hide_from_search = false where id='$GOLD';
SQL
asb "a hidden profile is still reachable by handle" "1" "$MEMBER" \
  "update public.profiles set hide_from_search = true where id='$MEMBER';
   select count(*) from public.profiles where handle='goldie';"
asb "search never returns the caller" "0" "$MEMBER" \
  "select count(*) from public.search_profiles('member', 10);"
# ── subscription status mapping (20260929001100) ────────────────────────────
# Run as the owner: sync_subscription_status is service_role-only by design, and
# the assertion above already proves `authenticated` cannot reach it.
syncmap() {
  q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
delete from public.billing_subscriptions where user_id='$MEMBER';
insert into public.billing_customers (user_id, stripe_customer_id)
  values ('$MEMBER', 'cus_test_$2') on conflict (user_id) do nothing;
insert into public.billing_subscriptions (id, user_id, status, current_period_end)
  values ('sub_test_$2', '$MEMBER', '$2', now() + interval '10 days');
SQL
  got=$(qt "select public.sync_subscription_status('$MEMBER')")
  if [ "$got" = "$3" ]; then ok "$1"; else bad "$1" "want '$3' got '$got'"; fi
}

# 'trialing' is entitled access, so it maps to active.
syncmap "stripe 'trialing' maps to active" "trialing" "active"
# Recoverable: Stripe is still retrying the card, so access continues.
syncmap "stripe 'past_due' keeps access (grace)" "past_due" "past_due"
syncmap "stripe 'incomplete' keeps access (grace)" "incomplete" "past_due"
# Terminal. This is the one 20260929001100 corrected: 'unpaid' means dunning ran
# out, and folding it in with past_due would have granted access indefinitely.
syncmap "stripe 'unpaid' is terminal, not grace" "unpaid" "canceled"
syncmap "stripe 'canceled' maps to canceled" "canceled" "canceled"

q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
delete from public.billing_subscriptions where user_id='$MEMBER';
update public.profiles set subscription_status='free' where id='$MEMBER';
SQL

echo
echo "Developer profiles, bookmarks, mentions"

# ── skills ──────────────────────────────────────────────────────────────────
asb "member can set their own skills" "2" "$MEMBER" \
  "update public.profiles set skills = array['Rust','  rust  ','Postgres'] where id='$MEMBER';
   select array_length(skills,1) from public.profiles where id='$MEMBER';"
asb "skills are lowercased and de-duplicated" "postgres,rust" "$MEMBER" \
  "update public.profiles set skills = array['Rust','rust','Postgres'] where id='$MEMBER';
   select array_to_string(skills, ',') from public.profiles where id='$MEMBER';"
asb "more than 20 skills is refused" "ERROR" "$MEMBER" \
  "update public.profiles set skills = (select array_agg('skill'||g) from generate_series(1,21) g) where id='$MEMBER';"
asb "an overlong skill is refused" "ERROR" "$MEMBER" \
  "update public.profiles set skills = array[repeat('x',31)] where id='$MEMBER';"
asb "a member cannot set someone else's skills" "0" "$MEMBER" \
  "update public.profiles set skills = array['pwned'] where id='$GOLD';
   select count(*) from public.profiles where id='$GOLD' and 'pwned' = any(skills);"

# Skills feed the search vector, which is the point of storing them as an array.
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
update public.profiles set skills = array['rust','postgres'] where id='$GOLD';
SQL
asb "people search finds a member by skill" "1" "$MEMBER" \
  "select count(*) from public.search_profiles('rust', 10);"
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
update public.profiles set skills = '{}' where id='$GOLD';
SQL

# ── location ────────────────────────────────────────────────────────────────
asb "member can set their own location" "Lagos" "$MEMBER" \
  "update public.profiles set location='Lagos' where id='$MEMBER';
   select location from public.profiles where id='$MEMBER';"
asb "an overlong location is refused" "ERROR" "$MEMBER" \
  "update public.profiles set location=repeat('x',81) where id='$MEMBER';"

# ── pinned projects ─────────────────────────────────────────────────────────
asb "member can pin a project" "1" "$MEMBER" \
  "insert into public.profile_projects (user_id, name, url) values ('$MEMBER','Ledger CLI','https://example.com');
   select count(*) from public.profile_projects where user_id='$MEMBER';"
asb "a project cannot be created for someone else" "ERROR" "$MEMBER" \
  "insert into public.profile_projects (user_id, name) values ('$GOLD','not mine');"
asb "a javascript: project url is refused" "ERROR" "$MEMBER" \
  "insert into public.profile_projects (user_id, name, url) values ('$MEMBER','x','javascript:alert(1)');"
asb "pinned projects are capped at 6" "ERROR" "$MEMBER" \
  "insert into public.profile_projects (user_id, name)
     select '$MEMBER', 'p'||g from generate_series(1,7) g;"
# Projects must disappear with the profile they belong to, in both directions.
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
insert into public.profile_projects (user_id, name) values ('$GOLD','Gold project');
insert into public.blocks (blocker_id, blocked_id) values ('$MEMBER','$GOLD');
SQL
asb "a blocked member's projects are hidden" "0" "$MEMBER" \
  "select count(*) from public.profile_projects where user_id='$GOLD';"
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
delete from public.blocks where blocker_id='$MEMBER' and blocked_id='$GOLD';
SQL
asb "an unblocked member's projects are visible" "1" "$MEMBER" \
  "select count(*) from public.profile_projects where user_id='$GOLD';"

# ── bookmarks: private, and that is the whole point ─────────────────────────
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
delete from public.bookmarks;
insert into public.bookmarks (user_id, post_id) values ('$GOLD', 'bbbb0000-0000-4000-8000-000000000001');
SQL
asb "a member cannot read another member's bookmarks" "0" "$MEMBER" \
  "select count(*) from public.bookmarks;"
asb "a member CAN read their own bookmarks" "1" "$GOLD" \
  "select count(*) from public.bookmarks;"
asb "a member cannot bookmark on someone else's behalf" "ERROR" "$MEMBER" \
  "insert into public.bookmarks (user_id, post_id) values ('$GOLD','bbbb0000-0000-4000-8000-000000000001');"
# Checked as the owner, not as the attacker. Counting from inside the attacker's
# transaction proves nothing: the SELECT policy hides the row from them either way,
# so a successful deletion and a blocked one both read as 0.
asb "a member's delete of someone else's bookmark affects nothing" "DELETE0" "$MEMBER" \
  "delete from public.bookmarks where user_id='$GOLD';"
asb "the owner's bookmark survived" "1" "$GOLD" \
  "select count(*) from public.bookmarks;"
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
delete from public.bookmarks;
SQL

# ── mentions ────────────────────────────────────────────────────────────────
# These use `q` + `chk` rather than `asb` for two reasons: asb rolls its
# transaction back, so a notification written by a trigger would vanish before it
# could be asserted; and notifications RLS means the author cannot read the
# recipient's row anyway. The trigger fires whatever role performs the insert, so
# running the insert as the owner tests the same code path.
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
delete from public.notifications where type='mention';
insert into public.posts (id, author_id, content)
  values ('eeee1111-0000-4000-8000-000000000001','$MEMBER','hey @goldie take a look');
SQL
chk "mentioning a member notifies them" "1" \
  "select count(*) from public.notifications where type='mention' and user_id='$GOLD'"
chk "the mention notification credits the right actor" "t" \
  "select actor_id = '$MEMBER' from public.notifications where type='mention' and user_id='$GOLD'"
chk "the mention notification points at the post" "t" \
  "select post_id = 'eeee1111-0000-4000-8000-000000000001' from public.notifications where type='mention' and user_id='$GOLD'"

q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
delete from public.notifications where type='mention';
insert into public.posts (id, author_id, content)
  values ('eeee1111-0000-4000-8000-000000000002','$MEMBER','@goldie @goldie ping');
SQL
chk "mentioning the same person twice notifies once" "1" \
  "select count(*) from public.notifications where type='mention' and user_id='$GOLD'"

q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
delete from public.notifications where type='mention';
insert into public.posts (id, author_id, content)
  values ('eeee1111-0000-4000-8000-000000000003','$MEMBER','note to self @member');
insert into public.posts (id, author_id, content)
  values ('eeee1111-0000-4000-8000-000000000004','$MEMBER','@nobody_here hello');
SQL
chk "mentioning yourself notifies nobody" "0" \
  "select count(*) from public.notifications where type='mention' and user_id='$MEMBER'"
chk "an unknown handle notifies nobody" "0" \
  "select count(*) from public.notifications where type='mention'"

# A block must stop someone reaching into your notifications by typing your name.
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
delete from public.notifications where type='mention';
insert into public.blocks (blocker_id, blocked_id) values ('$GOLD','$MEMBER');
insert into public.posts (id, author_id, content)
  values ('eeee1111-0000-4000-8000-000000000005','$MEMBER','@goldie you cannot ignore me');
SQL
chk "a mention across a block notifies nobody" "0" \
  "select count(*) from public.notifications where type='mention' and user_id='$GOLD'"

q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
delete from public.blocks where blocker_id='$GOLD' and blocked_id='$MEMBER';
delete from public.notifications where type='mention';
insert into public.comments (id, post_id, author_id, content)
  values ('eeee2222-0000-4000-8000-000000000001','bbbb0000-0000-4000-8000-000000000001','$MEMBER','cc @goldie');
SQL
chk "a mention in a comment also notifies" "1" \
  "select count(*) from public.notifications where type='mention' and user_id='$GOLD'"

chk "notifications accept type=mention" "t" \
  "select pg_get_constraintdef(oid) like '%mention%' from pg_constraint where conname='notifications_type_check'"

echo
echo "Verification anti-fraud"

# Every member gets a proof code, and it is NOT public. The code is what ties a
# claimed GitHub account or domain to this member, so one member being able to read
# another's would let them publish somebody else's proof.
chk "every profile has a verification proof code" "0" \
  "select count(*) from public.profiles where verification_proof_code is null"
chk "proof codes are distinct per member" "t" \
  "select count(distinct verification_proof_code) = count(*) from public.profiles"
chk "proof code is NOT readable by authenticated" "f" \
  "select has_column_privilege('authenticated','public.profiles','verification_proof_code','select')"
chk "proof code is NOT readable by anon" "f" \
  "select has_column_privilege('anon','public.profiles','verification_proof_code','select')"
chk "proof code is not client-writable" "f" \
  "select has_column_privilege('authenticated','public.profiles','verification_proof_code','update')"

# Gold was obtainable by typing a company name with no link of any kind. A reviewer
# cannot check a string, and neither can the automated proof check.
chk_err "a gold application with no verifiable link is refused" \
  "insert into public.verification_requests (user_id, tier, link_primary, fund_or_company_name) values ('$MEMBER','gold','https://example.com','Totally Real Capital')"
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
insert into public.verification_requests (user_id, tier, link_primary, fund_or_company_name, portfolio_url)
  values ('$MEMBER','gold','https://example.com','Real Capital','https://realcapital.example');
SQL
chk "a gold application WITH a link is accepted" "1" \
  "select count(*) from public.verification_requests where user_id='$MEMBER' and tier='gold'"
chk_err "a silver application with no github is refused" \
  "insert into public.verification_requests (user_id, tier, link_primary) values ('$GOLD','silver','https://example.com')"

# Only a *pending* application used to block a new one, so a rejected applicant
# could resubmit instantly and without limit.
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
delete from public.verification_requests;
insert into public.verification_requests (user_id, tier, link_primary, github_url, status, reviewed_at)
  values ('$MEMBER','silver','https://github.com/x','https://github.com/x','rejected', now() - interval '2 days');
SQL
chk_err "reapplying 2 days after a rejection is refused" \
  "insert into public.verification_requests (user_id, tier, link_primary, github_url) values ('$MEMBER','silver','https://github.com/x','https://github.com/x')"
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
update public.verification_requests set reviewed_at = now() - interval '9 days' where user_id='$MEMBER';
SQL
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
insert into public.verification_requests (user_id, tier, link_primary, github_url)
  values ('$MEMBER','silver','https://github.com/x','https://github.com/x');
SQL
chk "reapplying 9 days after a rejection is allowed" "1" \
  "select count(*) from public.verification_requests where user_id='$MEMBER' and tier='silver' and status='pending'"

# An account with no finished profile has no identity to verify.
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
delete from public.verification_requests;
update public.profiles set onboarding_completed = false where id='$MEMBER';
SQL
chk_err "an unonboarded account cannot apply" \
  "insert into public.verification_requests (user_id, tier, link_primary, github_url) values ('$MEMBER','silver','https://github.com/x','https://github.com/x')"
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
update public.profiles set onboarding_completed = true where id='$MEMBER';
SQL

# A newly approved Gold member had pitch_limit NULL, i.e. an uncapped inbox, at
# exactly the moment they became the most attractive target on the platform.
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
update public.profiles set verification_tier='none', pitch_limit=null where id='$MEMBER';
update public.profiles set verification_tier='gold' where id='$MEMBER';
SQL
chk "approving Gold caps the inbox by default" "10" \
  "select pitch_limit from public.profiles where id='$MEMBER'"
# ...but a Gold member who already chose a limit keeps it.
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
update public.profiles set verification_tier='none', pitch_limit=3 where id='$MEMBER';
update public.profiles set verification_tier='gold' where id='$MEMBER';
SQL
chk "an existing pitch limit is not overwritten" "3" \
  "select pitch_limit from public.profiles where id='$MEMBER'"
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
update public.profiles set verification_tier='none', pitch_limit=null where id='$MEMBER';
SQL

# The tier itself still cannot be self-granted -- the whole process rests on this.
asb "a member still cannot grant themselves gold" "ERROR" "$MEMBER" \
  "update public.profiles set verification_tier='gold' where id='$MEMBER';"
# RLS filters the row rather than raising, so the statement reports UPDATE 0. That
# is the secure outcome; the property worth asserting is that the status did not move.
q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
delete from public.verification_requests;
insert into public.verification_requests (user_id, tier, link_primary, github_url, status)
  values ('$MEMBER','silver','https://github.com/x','https://github.com/x','pending');
SQL
asb "a member's self-approval affects no rows" "UPDATE0" "$MEMBER" \
  "update public.verification_requests set status='approved' where user_id='$MEMBER';"
chk "the application is still pending afterwards" "pending" \
  "select status from public.verification_requests where user_id='$MEMBER'"


echo
printf "TOTAL: \033[32m%d passed\033[0m, \033[31m%d failed\033[0m\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "All migration assertions passed."

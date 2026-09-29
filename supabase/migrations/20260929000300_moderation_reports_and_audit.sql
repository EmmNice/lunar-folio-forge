-- Give the report button somewhere to go, and give admins a way to act.
--
-- Today PostCard inserts into `reports` and toasts "Thanks -- the moderators will
-- review." Nothing reads that table. There is no review surface, no status, no
-- reason captured, and no admin action stronger than revoking a verification
-- badge: no suspend, no ban, no way to remove someone else's content. For a
-- platform about to take real users that toast is a promise with no mechanism
-- behind it.
--
-- This migration adds the missing half of the loop:
--   * reports get a reason, a status and a reviewer
--   * admins can update reports
--   * every privileged admin action is written to an append-only audit table
--   * pitches get the constraints their UI already assumes

-- ---------------------------------------------------------------------------
-- 1. Reports become reviewable
-- ---------------------------------------------------------------------------

alter table public.reports
  add column if not exists status text not null default 'open',
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists resolution_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reports_status_valid') then
    alter table public.reports add constraint reports_status_valid
      check (status in ('open', 'actioned', 'dismissed'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'reports_resolution_note_len') then
    alter table public.reports add constraint reports_resolution_note_len
      check (resolution_note is null or char_length(resolution_note) <= 500);
  end if;
end $$;

create index if not exists reports_open_idx
  on public.reports (created_at desc)
  where status = 'open';

-- Reporters could already read their own rows and admins could read all
-- (20260928000300). Only admins may resolve one.
drop policy if exists "admins can resolve reports" on public.reports;
create policy "admins can resolve reports" on public.reports
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. Admin audit trail
-- ---------------------------------------------------------------------------
-- Badge grants, revocations and suspensions were completely unattributable:
-- reviewApplication even had the reviewer's id in hand and threw it away. If two
-- people ever share admin rights, "who banned this member and why" needs an
-- answer.

create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint admin_actions_action_len check (char_length(action) between 1 and 60),
  constraint admin_actions_target_type_valid
    check (target_type in ('profile', 'post', 'comment', 'report', 'verification_request'))
);

create index if not exists admin_actions_created_idx on public.admin_actions (created_at desc);
create index if not exists admin_actions_target_idx on public.admin_actions (target_type, target_id);

alter table public.admin_actions enable row level security;

-- Readable by admins; written only by the service role from a server function,
-- so there is deliberately no INSERT policy and no write grant. An append-only
-- log that the actor can edit is not a log.
revoke all on public.admin_actions from anon, authenticated;
grant select on public.admin_actions to authenticated;

drop policy if exists "admins can read the audit log" on public.admin_actions;
create policy "admins can read the audit log" on public.admin_actions
  for select to authenticated
  using (public.is_admin());

comment on table public.admin_actions is
  'Append-only record of privileged admin actions. Written by server functions '
  'with the service role; no INSERT policy exists on purpose.';

-- ---------------------------------------------------------------------------
-- 3. Moderators need to be able to remove content
-- ---------------------------------------------------------------------------
-- deletePost is scoped to `author_id = auth.uid()`, and there was no admin
-- delete path at all -- so the only response to an abusive post was to ask the
-- author nicely. Removal still runs through a server function (which writes the
-- audit row); these policies are what let that function's admin check mean
-- something if it is ever called with the user's own token.

drop policy if exists "admins can delete any post" on public.posts;
create policy "admins can delete any post" on public.posts
  for delete to authenticated
  using (public.is_admin());

drop policy if exists "admins can delete any comment" on public.comments;
create policy "admins can delete any comment" on public.comments
  for delete to authenticated
  using (public.is_admin());

-- Who approved this badge? reviewApplication has always had the reviewer's id in
-- hand and discarded it, so verification_requests recorded that a decision
-- happened but never by whom.
alter table public.verification_requests
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. Pitches: the constraints the UI already assumed
-- ---------------------------------------------------------------------------

update public.pitches
   set status = 'pending'
 where status is null
    or status not in ('pending', 'accepted', 'declined');

alter table public.pitches alter column status set default 'pending';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pitches_status_valid') then
    alter table public.pitches add constraint pitches_status_valid
      check (status in ('pending', 'accepted', 'declined'));
  end if;
end $$;

-- These three policies were created for role `public`, which includes `anon`.
-- The anon write grants were revoked in 20260928000800 so nothing was reachable,
-- but a policy scoped wider than the role that should hold it is a trap for the
-- next person who adds a grant.
drop policy if exists pitches_select_parties on public.pitches;
create policy pitches_select_parties on public.pitches
  for select to authenticated
  using (recipient_id = auth.uid() or sender_id = auth.uid());

drop policy if exists pitches_insert_verified on public.pitches;
create policy pitches_insert_verified on public.pitches
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.actor_is_active()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and verification_tier in ('silver', 'gold')
    )
  );

drop policy if exists pitches_update_recipient on public.pitches;
create policy pitches_update_recipient on public.pitches
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- A policy cannot compare NEW to OLD, so "the recipient may accept or decline
-- but not rewrite what was pitched" has to be a trigger. Without this, the
-- recipient-update policy let them edit company_name, pitch and deck_url on a
-- pitch someone else wrote.
-- Trigger functions are never meant to be called directly; Supabase's default
-- privileges grant EXECUTE on them to anon/authenticated anyway.
create or replace function public.guard_pitch_immutable_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.sender_id is distinct from old.sender_id
     or new.recipient_id is distinct from old.recipient_id
     or new.company_name is distinct from old.company_name
     or new.pitch is distinct from old.pitch
     or new.deck_url is distinct from old.deck_url
     or new.created_at is distinct from old.created_at then
    raise exception 'only the status of a pitch can change'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_pitch_immutable_columns() from public, anon, authenticated;

drop trigger if exists pitches_guard_immutable on public.pitches;
create trigger pitches_guard_immutable
  before update on public.pitches
  for each row execute function public.guard_pitch_immutable_columns();

-- ---------------------------------------------------------------------------
-- 5. Notifications for messages and pitches
-- ---------------------------------------------------------------------------
-- "New Message Alerts" has been a switch wired to nothing: no code path reads
-- notification_prefs.messages, and a DM produced no notification of any kind, so
-- the only way to discover one was to open the inbox. Pitches were the same --
-- email only, nothing in the bell.

alter table public.notifications
  add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'like', 'comment', 'repost',
    'verification_approved', 'verification_rejected',
    'message', 'pitch'
  ));

create index if not exists notifications_unread_convo_idx
  on public.notifications (user_id, conversation_id)
  where read = false and type = 'message';

-- One unread badge per conversation, not one per message: collapsing on the
-- existing unread row is what stops a ten-message burst becoming ten rows.
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

  if _recipient is null or _recipient = new.sender_id then
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

revoke all on function public.notify_on_message() from public, anon, authenticated;

drop trigger if exists trg_notify_message on public.messages;
create trigger trg_notify_message
  after insert on public.messages
  for each row execute function public.notify_on_message();

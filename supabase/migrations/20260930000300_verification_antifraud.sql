-- Makes verification something you have to prove rather than something you can claim.
--
-- What the review process actually asked for before this:
--
--   Silver — a GitHub URL. Any URL. Nothing checked that the applicant had ever
--            seen the account behind it, so `https://github.com/torvalds` was a
--            complete, valid Silver application.
--   Gold   — `fund_or_company_name`, a free-text string. No link required at all.
--            Gold is the tier that can send pitches and read the Whisper feed, and
--            it was obtainable by typing a plausible company name.
--
-- A human reviewer was the only defence, and a reviewer looking at a GitHub URL
-- cannot tell whose GitHub it is. Three things change:
--
--   1. Every member gets a stable proof code. To be verified you publish it
--      somewhere only the real owner could — your GitHub bio, or the company site
--      you claim to represent — and the server fetches it and checks. That is the
--      part that cannot be faked without actually controlling the thing you claim.
--   2. Gold must supply a verifiable URL, not just a name.
--   3. A rejected application cannot be resubmitted immediately, so the review
--      queue cannot be flooded.
--
-- The reviewer still decides. This removes the cases where they had nothing to
-- decide *with*.

-- ---------------------------------------------------------------------------
-- 1. A stable per-member proof code
-- ---------------------------------------------------------------------------
/*
 * Stable rather than per-application, so re-submitting does not invalidate a code
 * the member has already published — which would mean editing their GitHub bio
 * again for every attempt.
 *
 * Not secret: it is meant to be published. Its value is that only the owner of the
 * claimed account or domain can put *this member's* code there, which is what ties
 * the two identities together. Random rather than derived from the user id, so it
 * does not leak an internal identifier onto a public profile.
 */
alter table public.profiles
  add column if not exists verification_proof_code text;

update public.profiles
   set verification_proof_code = 'ledger-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
 where verification_proof_code is null;

alter table public.profiles
  alter column verification_proof_code set default
    'ledger-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);

alter table public.profiles
  alter column verification_proof_code set not null;

comment on column public.profiles.verification_proof_code is
  'Published by the member to prove they control a claimed GitHub account or '
  'domain. Readable only by its owner (via current_profile) and by admins — not '
  'granted to `authenticated` at the column level, so it is not public.';

-- Deliberately NOT granted to anon/authenticated. The owner reads it through
-- current_profile() (SECURITY DEFINER); nobody else needs it, and publishing
-- everyone's code would let one member post another member's proof.

-- ---------------------------------------------------------------------------
-- 2. Proof state on the application
-- ---------------------------------------------------------------------------
alter table public.verification_requests
  add column if not exists proof_verified_at timestamptz,
  add column if not exists proof_method text,
  add column if not exists proof_detail text;

alter table public.verification_requests
  drop constraint if exists vr_proof_method_check;
alter table public.verification_requests
  add constraint vr_proof_method_check check (
    proof_method is null or proof_method = any (array[
      'github_bio',      -- the code was found on the claimed GitHub profile
      'github_website',  -- ...in the website field of that profile
      'domain_page',     -- ...on the claimed company/portfolio page
      'manual'           -- an admin vouched for it out of band, and said so
    ])
  );

comment on column public.verification_requests.proof_verified_at is
  'When the server confirmed the proof code was published at the claimed location. '
  'NULL means unproven — the admin panel shows that prominently, because an '
  'unproven application is a claim rather than evidence.';

-- ---------------------------------------------------------------------------
-- 3. Gold must be checkable
-- ---------------------------------------------------------------------------
-- A name is not evidence. Gold now needs somewhere a reviewer (and the automated
-- proof check) can actually look.
alter table public.verification_requests
  drop constraint if exists vr_gold_needs_a_link;
alter table public.verification_requests
  add constraint vr_gold_needs_a_link check (
    tier <> 'gold'
    or portfolio_url is not null
    or linkedin_or_x_url is not null
  );

-- Silver already required github_url through the server validator; make it a
-- database rule too, so it holds for anything writing this table.
alter table public.verification_requests
  drop constraint if exists vr_silver_needs_github;
alter table public.verification_requests
  add constraint vr_silver_needs_github check (
    tier <> 'silver' or github_url is not null
  );

-- ---------------------------------------------------------------------------
-- 4. A rejected application cannot be resubmitted immediately
-- ---------------------------------------------------------------------------
/*
 * Only a *pending* application blocked a new one, so a rejected applicant could
 * reapply instantly and without limit — which turns the review queue into
 * something one determined person can flood.
 *
 * Seven days. Long enough that reapplying means having actually changed something,
 * short enough that a genuine applicant who misunderstood the requirements is not
 * shut out for a month.
 */
create or replace function public.guard_verification_reapply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _last_rejected timestamptz;
  _onboarded boolean;
begin
  -- An account that has not finished onboarding has no identity to verify yet.
  select onboarding_completed into _onboarded
    from public.profiles where id = new.user_id;
  if not coalesce(_onboarded, false) then
    raise exception 'finish setting up your profile before applying for verification'
      using errcode = '23514';
  end if;

  select max(reviewed_at) into _last_rejected
    from public.verification_requests
   where user_id = new.user_id
     and tier = new.tier
     and status = 'rejected';

  if _last_rejected is not null and _last_rejected > now() - interval '7 days' then
    raise exception 'you can reapply for this tier 7 days after a rejection'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_verification_reapply() from public, anon, authenticated;

drop trigger if exists vr_guard_reapply on public.verification_requests;
create trigger vr_guard_reapply
  before insert on public.verification_requests
  for each row execute function public.guard_verification_reapply();

-- ---------------------------------------------------------------------------
-- 5. Gold gets spam protection by default
-- ---------------------------------------------------------------------------
/*
 * A newly approved Gold member had `pitch_limit = NULL`, which means *unlimited*
 * inbound pitches. So the moment someone became visibly Gold — the tier every
 * pitching member is looking for — their inbox was uncapped, and they had to
 * discover the setting to fix it.
 *
 * Default to a weekly cap on approval. It is a setting they can raise, lower or
 * remove; the point is that the safe value is the one they start with rather than
 * the one they have to find. Only applied when the column is still NULL, so a Gold
 * member who has already chosen a limit keeps it.
 */
create or replace function public.protect_new_gold_inbox()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verification_tier = 'gold'
     and old.verification_tier is distinct from 'gold'
     and new.pitch_limit is null then
    new.pitch_limit := 10;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_new_gold_inbox() from public, anon, authenticated;

drop trigger if exists profiles_protect_gold_inbox on public.profiles;
create trigger profiles_protect_gold_inbox
  before update of verification_tier on public.profiles
  for each row execute function public.protect_new_gold_inbox();

-- ---------------------------------------------------------------------------
-- 6. Gold-only inboxes are reachable only by verified senders
-- ---------------------------------------------------------------------------
-- Already true for pitches via pitches_insert_verified. Restated here as a comment
-- rather than re-created, because the rule lives in 20260929000700 and duplicating
-- it would give two places to keep in step:
--
--   pitches  — sender must be silver or gold, recipient must be gold, blocks
--              honoured, and claim_pitch_slot() enforces the weekly cap atomically.
--   messages — dm_cloaking_enabled lets any member restrict DMs to verified
--              senders, enforced in startConversation with the service role.

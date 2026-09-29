-- Redefines what the two badges are for, and makes the requirements real.
--
-- What they meant before:
--
--   Silver — "Recognized Builder", described as "for active builders who ship".
--            In practice the only enforced requirement was a GitHub URL.
--   Gold   — "Verified Investor", "for fund managers & angels". So a founder who
--            had launched a product with real users and real transactions had
--            nowhere to go: Silver undersold them and Gold did not describe them.
--
-- What they mean now:
--
--   Silver — anyone building. Developers, startup teams, designers, indie
--            hackers. The bar is that you ship something and can prove the
--            account is yours.
--   Gold   — two different kinds of person who both need the same reach, so the
--            tier now carries a track saying which:
--              'founder' — launched a product that has real users and real
--                          transactions. Not an idea, not a landing page.
--              'backer'  — funds, angels and investors who write cheques.
--
-- The requirements are per track, enforced here rather than described in the UI
-- and hoped for. A tier whose rules live only in form copy is a tier whose rules
-- change every time somebody edits the copy.

-- ---------------------------------------------------------------------------
-- 1. Which kind of Gold
-- ---------------------------------------------------------------------------
alter table public.verification_requests
  add column if not exists gold_track text;

alter table public.verification_requests
  drop constraint if exists vr_gold_track_valid;
alter table public.verification_requests
  add constraint vr_gold_track_valid check (
    gold_track is null or gold_track = any (array['founder', 'backer'])
  );

-- Gold must say which track. Silver must not claim one.
alter table public.verification_requests
  drop constraint if exists vr_gold_track_required;
alter table public.verification_requests
  add constraint vr_gold_track_required check (
    (tier = 'gold' and gold_track is not null)
    or (tier <> 'gold' and gold_track is null)
  );

comment on column public.verification_requests.gold_track is
  'Which kind of Gold: ''founder'' (launched, has users and transactions) or '
  '''backer'' (invests). They need the same reach and prove it completely '
  'differently, so the evidence rules below branch on this.';

-- ---------------------------------------------------------------------------
-- 2. Traction, for the founder track
-- ---------------------------------------------------------------------------
/*
 * Two fields, because there are two different kinds of claim and conflating them
 * is how "verified" stops meaning anything.
 *
 * traction_summary is what the applicant says: "1,400 weekly actives, $38k
 * settled last month". Useful, unverifiable, and labelled as a claim everywhere
 * it is displayed.
 *
 * traction_evidence_url is somewhere a reviewer can go and look: a public
 * analytics page, a block explorer showing the contract's activity, an app store
 * listing with a rating count, a status page. That is the half that carries
 * weight, so the CHECK below requires it (or an on-chain address, which is the
 * same thing by another route).
 */
alter table public.verification_requests
  add column if not exists traction_summary text,
  add column if not exists traction_evidence_url text;

alter table public.verification_requests
  drop constraint if exists vr_traction_summary_len;
alter table public.verification_requests
  add constraint vr_traction_summary_len check (
    traction_summary is null or char_length(traction_summary) <= 280
  );

alter table public.verification_requests
  drop constraint if exists vr_traction_evidence_scheme;
alter table public.verification_requests
  add constraint vr_traction_evidence_scheme check (
    traction_evidence_url is null or traction_evidence_url ~* '^https?://'
  );

comment on column public.verification_requests.traction_summary is
  'Numbers as claimed by the applicant. Never verified, always displayed as a '
  'claim — the reviewer weighs traction_evidence_url instead.';
comment on column public.verification_requests.traction_evidence_url is
  'Somewhere public that corroborates the traction claim: analytics, a block '
  'explorer, a store listing. Required for the founder track.';

-- ---------------------------------------------------------------------------
-- 3. Objective signals the server measured
-- ---------------------------------------------------------------------------
/*
 * Facts, collected server-side at submit: how many public repositories the GitHub
 * account has, how old it is, whether it has been pushed to recently, whether the
 * product URL actually resolves.
 *
 * Kept apart from the applicant's own answers on purpose. A reviewer looking at a
 * card should be able to tell at a glance which statements came from the person
 * asking for the badge and which came from going and checking — previously every
 * field on the card was the former.
 *
 * jsonb rather than columns because the set of things worth measuring will change,
 * and none of it is queried or constrained; it is read as a whole and shown.
 */
alter table public.verification_requests
  add column if not exists applicant_signals jsonb not null default '{}'::jsonb;

comment on column public.verification_requests.applicant_signals is
  'Measured by the server, not supplied by the applicant. Displayed separately '
  'from their claims so a reviewer can tell evidence from assertion.';

-- ---------------------------------------------------------------------------
-- 4. Evidence requirements, per tier and track
-- ---------------------------------------------------------------------------
/*
 * Silver previously required only a GitHub URL, so "for builders who ship" was
 * enforced as "has a GitHub account". It now needs something shipped as well —
 * a live URL or a deployed contract — which is the actual claim being made.
 *
 * Gold's old rule (`portfolio_url or linkedin_or_x_url`) was written for investors
 * and is meaningless for a founder: a LinkedIn profile is not evidence that a
 * product has users. Replaced by track-specific rules.
 */
alter table public.verification_requests
  drop constraint if exists vr_silver_needs_github;
alter table public.verification_requests
  add constraint vr_silver_needs_github check (
    tier <> 'silver' or github_url is not null
  );

alter table public.verification_requests
  drop constraint if exists vr_silver_needs_something_shipped;
alter table public.verification_requests
  add constraint vr_silver_needs_something_shipped check (
    tier <> 'silver'
    or live_project_url is not null
    or deployed_contract_address is not null
  );

-- Replaces vr_gold_needs_a_link, which could not tell the two tracks apart.
alter table public.verification_requests
  drop constraint if exists vr_gold_needs_a_link;

alter table public.verification_requests
  drop constraint if exists vr_gold_founder_needs_evidence;
alter table public.verification_requests
  add constraint vr_gold_founder_needs_evidence check (
    tier <> 'gold'
    or gold_track <> 'founder'
    or (
      live_project_url is not null
      and (traction_evidence_url is not null or deployed_contract_address is not null)
    )
  );

alter table public.verification_requests
  drop constraint if exists vr_gold_backer_needs_evidence;
alter table public.verification_requests
  add constraint vr_gold_backer_needs_evidence check (
    tier <> 'gold'
    or gold_track <> 'backer'
    or (
      fund_or_company_name is not null
      and (portfolio_url is not null or linkedin_or_x_url is not null)
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Proof method for the founder track
-- ---------------------------------------------------------------------------
-- A founder proves ownership by publishing the code on the product itself, which
-- is 'domain_page' — already permitted. Restated so the list is readable next to
-- the new tracks rather than needing the earlier migration to interpret.
alter table public.verification_requests
  drop constraint if exists vr_proof_method_check;
alter table public.verification_requests
  add constraint vr_proof_method_check check (
    proof_method is null or proof_method = any (array[
      'github_bio',      -- code found on the claimed GitHub profile
      'github_website',  -- ...in the website field of that profile
      'domain_page',     -- ...on the claimed product, company or portfolio page
      'manual'           -- an admin vouched for it out of band, and said so
    ])
  );

-- ---------------------------------------------------------------------------
-- 6. Members may read the signals and track on their own applications
-- ---------------------------------------------------------------------------
-- Covered by the existing table-wide SELECT grant; asserted so a later
-- column-level narrowing does not hide from applicants what was measured about
-- them. Writes stay service-role only: `authenticated` holds no UPDATE on this
-- table at all (20260930000500).
do $$
begin
  if not has_column_privilege('authenticated', 'public.verification_requests',
                              'applicant_signals', 'SELECT') then
    grant select (gold_track, traction_summary, traction_evidence_url, applicant_signals)
      on public.verification_requests to authenticated;
  end if;
end $$;

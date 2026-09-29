-- Bookkeeping for the automated proof check.
--
-- 20260930000300 added the proof *code* and somewhere to record a successful
-- check (proof_verified_at / proof_method / proof_detail). It had nowhere to
-- record an *attempt*, which leaves two gaps:
--
--   1. No cooldown. The check makes the server fetch a URL, so an unlimited
--      button is an unlimited outbound request generator with our IP on it.
--   2. No way for a reviewer to tell "nobody has looked yet" from "we looked
--      and the code was not there". Both read as proof_verified_at IS NULL, and
--      they mean very different things about an application.

alter table public.verification_requests
  add column if not exists proof_checked_at timestamptz,
  add column if not exists proof_attempts integer not null default 0;

comment on column public.verification_requests.proof_checked_at is
  'Last time the automated check ran, successful or not. With proof_verified_at '
  'still NULL this means the check ran and did not find the code — which is a '
  'finding, not an absence of one.';

comment on column public.verification_requests.proof_attempts is
  'How many times the check has run. Shown to reviewers: an application on its '
  'ninth failed attempt reads differently from one on its first.';

-- proof_detail carries the failure reason when a check fails, so it is no longer
-- only written on success. Restated because the earlier comment said otherwise.
comment on column public.verification_requests.proof_detail is
  'On success, where the code was found. On failure, why the check could not '
  'confirm it — shown to the applicant so they can fix it themselves.';

-- ---------------------------------------------------------------------------
-- Members may read the proof state of their own applications
-- ---------------------------------------------------------------------------
/*
 * The applicant needs to see whether the check passed, otherwise the only way to
 * find out is to wait for a human decision. There is already a SELECT policy for
 * own rows on this table; these columns are covered by it because the grant is
 * table-wide. Asserted here so a future column-level narrowing does not silently
 * hide the result from the person it is about.
 */
do $$
begin
  if not exists (
    select 1 from information_schema.column_privileges
     where grantee = 'authenticated'
       and table_schema = 'public'
       and table_name = 'verification_requests'
       and column_name = 'proof_verified_at'
       and privilege_type = 'SELECT'
  ) then
    grant select (proof_verified_at, proof_method, proof_detail, proof_checked_at, proof_attempts)
      on public.verification_requests to authenticated;
  end if;
end $$;

-- The proof columns are written by the server (service role) only. A member who
-- could set proof_verified_at on their own row would have defeated the entire
-- mechanism, so this is left out of the `authenticated` UPDATE grant — and the
-- table has no column-level UPDATE grant to members at all, only INSERT.

-- A $1 application fee on both tiers.
--
-- The point of charging is not the dollar. It is that a card that clears is a
-- weak but real identity signal, and that a queue which costs nothing to join is
-- a queue anyone can flood — the 7-day reapply cooldown in 20260930000300 slows
-- one person down, a fee changes the economics for all of them.
--
-- Three states, because "we did not take money" splits into two very different
-- situations and collapsing them is how a platform ends up unable to say whether
-- it was ever paid:
--
--   unpaid  — an application exists but checkout was never completed. Not in the
--             review queue. The applicant can finish paying, or start again.
--   paid    — Stripe confirmed it. payment_reference holds the session id.
--   waived  — accepted deliberately without payment, with the reason recorded.
--             This is what an unconfigured deployment produces, and what an admin
--             comping somebody would produce. Never silently equivalent to paid.
--
-- The waived state matters for an honest reason: this deployment has no Stripe
-- credentials at all. Without the third state the only options would be to block
-- every application until billing is set up, or to let them through while marking
-- them "paid" — which would be a lie written into the database. Instead they are
-- marked waived with `no payment provider configured`, and the admin panel says
-- so on the card. The moment STRIPE_SECRET_KEY exists, the fee is enforced and
-- nothing about this migration changes.

alter table public.verification_requests
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists payment_reference text,
  add column if not exists payment_waived_reason text,
  add column if not exists amount_cents integer,
  add column if not exists paid_at timestamptz;

alter table public.verification_requests
  drop constraint if exists vr_payment_status_valid;
alter table public.verification_requests
  add constraint vr_payment_status_valid check (
    payment_status = any (array['unpaid', 'paid', 'waived'])
  );

-- Paid means Stripe said so, which means there is a reference to point at.
alter table public.verification_requests
  drop constraint if exists vr_paid_needs_reference;
alter table public.verification_requests
  add constraint vr_paid_needs_reference check (
    payment_status <> 'paid' or (payment_reference is not null and paid_at is not null)
  );

-- Waived means somebody decided to waive it, which means there is a reason.
alter table public.verification_requests
  drop constraint if exists vr_waived_needs_reason;
alter table public.verification_requests
  add constraint vr_waived_needs_reason check (
    payment_status <> 'waived' or payment_waived_reason is not null
  );

comment on column public.verification_requests.payment_status is
  'unpaid (checkout not completed, not in the review queue) | paid (Stripe '
  'confirmed) | waived (deliberately accepted without payment, reason recorded). '
  'Written only by the server; members hold no UPDATE on this table.';
comment on column public.verification_requests.payment_waived_reason is
  'Why no money was taken. Displayed to reviewers, so a waived application is '
  'never mistaken for a paid one.';

-- Existing applications predate the fee. Marking them waived rather than paid
-- keeps the record true: nobody was ever charged for these.
update public.verification_requests
   set payment_status = 'waived',
       payment_waived_reason = 'submitted before the application fee existed'
 where payment_status = 'unpaid'
   and payment_waived_reason is null
   and created_at < now();

-- ---------------------------------------------------------------------------
-- An unpaid application cannot be approved
-- ---------------------------------------------------------------------------
/*
 * The server refuses this too, and the admin UI does not offer it. This is the
 * layer that holds when neither of those does: approving is the statement that
 * grants a badge, and it should not be reachable for an application that never
 * completed the thing it was gated on.
 *
 * Deliberately a trigger rather than a CHECK: a CHECK cannot see that the status
 * is *changing* to approved, so it would also reject unrelated updates to rows
 * that happen to be unpaid.
 */
create or replace function public.guard_unpaid_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved'
     and old.status is distinct from 'approved'
     and new.payment_status = 'unpaid' then
    raise exception 'this application has not been paid for and cannot be approved'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_unpaid_approval() from public, anon, authenticated;

drop trigger if exists vr_guard_unpaid_approval on public.verification_requests;
create trigger vr_guard_unpaid_approval
  before update of status on public.verification_requests
  for each row execute function public.guard_unpaid_approval();

-- ---------------------------------------------------------------------------
-- Applicants may read their own payment state
-- ---------------------------------------------------------------------------
-- Otherwise somebody who abandoned checkout has no way to discover that their
-- application is sitting unpaid, and would just see it as never reviewed.
do $$
begin
  if not has_column_privilege('authenticated', 'public.verification_requests',
                              'payment_status', 'SELECT') then
    grant select (payment_status, payment_reference, payment_waived_reason,
                  amount_cents, paid_at)
      on public.verification_requests to authenticated;
  end if;
end $$;

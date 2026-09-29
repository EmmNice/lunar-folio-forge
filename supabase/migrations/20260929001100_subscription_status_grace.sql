-- Corrects the Stripe status mapping so 'past_due' means "retrying", not "gave up".
--
-- 20260929001000 folded 'unpaid' in with 'past_due'. Those are not the same state:
-- `past_due` is Stripe mid-dunning, still attempting the card; `unpaid` is dunning
-- finished and failed. Treating them alike forced a choice between two bad
-- outcomes — either past_due grants nothing (so the grace period the mapping was
-- written for does not exist), or it grants access and `unpaid` grants it forever,
-- because nothing after dunning ever moves the row again.
--
-- Split them. 'past_due' and 'incomplete' are the recoverable states and keep the
-- entitlement; 'unpaid' joins the terminal ones. hasUnlimitedAi() in
-- src/lib/entitlements.ts honours 'active' and 'past_due', so the grace window is
-- now real and bounded by Stripe's own dunning schedule rather than open-ended.

create or replace function public.sync_subscription_status(_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  _best text;
  _mapped text;
begin
  select s.status
    into _best
    from public.billing_subscriptions s
   where s.user_id = _user_id
   order by case s.status
              when 'active' then 1
              when 'trialing' then 2
              when 'past_due' then 3
              when 'incomplete' then 4
              when 'unpaid' then 5
              when 'paused' then 6
              when 'canceled' then 7
              else 8
            end,
            s.current_period_end desc nulls last
   limit 1;

  _mapped := case
    when _best in ('active', 'trialing') then 'active'
    -- Recoverable: Stripe is still retrying the card.
    when _best in ('past_due', 'incomplete') then 'past_due'
    -- Terminal. 'unpaid' belongs here: dunning ran to the end and failed.
    when _best in ('canceled', 'paused', 'unpaid', 'incomplete_expired') then 'canceled'
    else 'free'
  end;

  update public.profiles set subscription_status = _mapped where id = _user_id;
  return _mapped;
end;
$$;

comment on function public.sync_subscription_status(uuid) is
  'Recomputes profiles.subscription_status from billing_subscriptions. Called by '
  'the Stripe webhook after every write so the two cannot drift. active/trialing '
  '-> active; past_due/incomplete -> past_due (still retrying, keeps access); '
  'unpaid/canceled/paused/incomplete_expired -> canceled.';

-- Unchanged from 20260929001000, restated because CREATE OR REPLACE resets
-- nothing but is cheap to be explicit about: service_role only.
revoke all on function public.sync_subscription_status(uuid) from public, anon, authenticated;

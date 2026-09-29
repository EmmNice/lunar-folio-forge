-- Billing.
--
-- `profiles.subscription_status` has existed with a constrained domain since
-- 20260928000700, set by hand, with a comment saying a future provider would have
-- somewhere to write. This is that provider's schema.
--
-- Shape follows one rule: Stripe is the source of truth and this database is a
-- cache of it. Nothing here is computed locally — every row is written by the
-- webhook from a Stripe event, and `profiles.subscription_status` is derived from
-- the subscription rows rather than being set independently. That way a missed
-- webhook is recoverable by replaying events instead of by hand-reconciling two
-- sources that disagree.
--
-- There are no client write grants on any of these tables. Checkout happens in a
-- server function and state changes arrive by webhook; a browser that could write
-- its own subscription row would make the whole thing decorative.

-- ---------------------------------------------------------------------------
-- 1. Customers
-- ---------------------------------------------------------------------------

create table if not exists public.billing_customers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

alter table public.billing_customers enable row level security;
revoke all on public.billing_customers from anon, authenticated;
grant select on public.billing_customers to authenticated;

drop policy if exists "members read own billing customer" on public.billing_customers;
create policy "members read own billing customer" on public.billing_customers
  for select to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. Subscriptions
-- ---------------------------------------------------------------------------

create table if not exists public.billing_subscriptions (
  -- Stripe's subscription id, so the webhook is naturally idempotent on upsert.
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null,
  price_id text,
  quantity integer not null default 1,
  cancel_at_period_end boolean not null default false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Stripe's own vocabulary, kept verbatim rather than mapped on the way in, so
  -- an unexpected value is a loud constraint violation instead of a silent
  -- downgrade to 'free'.
  constraint billing_subscriptions_status_valid check (status in (
    'incomplete', 'incomplete_expired', 'trialing', 'active',
    'past_due', 'canceled', 'unpaid', 'paused'
  ))
);

create index if not exists billing_subscriptions_user_idx on public.billing_subscriptions (user_id);

alter table public.billing_subscriptions enable row level security;
revoke all on public.billing_subscriptions from anon, authenticated;
grant select on public.billing_subscriptions to authenticated;

drop policy if exists "members read own subscriptions" on public.billing_subscriptions;
create policy "members read own subscriptions" on public.billing_subscriptions
  for select to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. Event log
-- ---------------------------------------------------------------------------
-- Stripe retries webhooks, and will happily deliver the same event more than
-- once. Recording the event id and refusing duplicates is what stops a retried
-- `customer.subscription.deleted` from cancelling a subscription the member has
-- since renewed.

create table if not exists public.billing_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  payload jsonb
);

create index if not exists billing_events_received_idx on public.billing_events (received_at desc);

alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated;
-- Readable by admins only: the payload carries Stripe customer identifiers.
grant select on public.billing_events to authenticated;

drop policy if exists "admins read billing events" on public.billing_events;
create policy "admins read billing events" on public.billing_events
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. Derive profiles.subscription_status
-- ---------------------------------------------------------------------------
-- One function, called by the webhook after every write, so the column the app
-- actually reads can never disagree with the subscription rows underneath it.
--
-- 'trialing' maps to 'active' because a trial is entitled access. 'incomplete'
-- and 'unpaid' map to 'past_due' so the member keeps access while a payment is
-- being retried rather than being cut off mid-cycle by a card hiccup.

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
              when 'unpaid' then 4
              when 'incomplete' then 5
              when 'paused' then 6
              when 'canceled' then 7
              else 8
            end,
            s.current_period_end desc nulls last
   limit 1;

  _mapped := case
    when _best in ('active', 'trialing') then 'active'
    when _best in ('past_due', 'unpaid', 'incomplete') then 'past_due'
    when _best in ('canceled', 'paused', 'incomplete_expired') then 'canceled'
    else 'free'
  end;

  update public.profiles set subscription_status = _mapped where id = _user_id;
  return _mapped;
end;
$$;

comment on function public.sync_subscription_status(uuid) is
  'Recomputes profiles.subscription_status from billing_subscriptions. Called by '
  'the Stripe webhook after every write so the two cannot drift.';

-- service_role only. A member who could call this could not change the outcome
-- (it only reads their subscription rows), but it writes a privileged column and
-- there is no reason for it to be reachable from a browser.
revoke all on function public.sync_subscription_status(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. subscription_status stays out of reach
-- ---------------------------------------------------------------------------
-- Already enforced by guard_privileged_profile_columns and by the column grants
-- in 20260929000100. Re-asserted here as documentation: with billing live, this
-- column is money, and the only writer is the webhook path above.

-- Constrain subscription_status to the states the product actually has.
--
-- The column was free text defaulting to 'active', which is how every account
-- ended up on an implied paid plan and made the PulseAssist cap unreachable.
-- 20260928000200 changed the default to 'free'; this pins the domain so a typo
-- or a future integration cannot introduce a value that silently grants
-- unlimited access.
--
-- Entitlement rule, for reference (src/lib/entitlements.ts):
--   verification_tier in ('silver','gold')  -> unlimited PulseAssist
--   subscription_status = 'active'          -> unlimited PulseAssist
--   otherwise                               -> DAILY_AI_CREDITS per rolling 24h
--
-- There is no billing integration yet, so 'active' is only ever set by hand.
-- 'past_due' and 'canceled' exist so a future provider has somewhere to write
-- without another migration; neither grants unlimited access.

update public.profiles
set subscription_status = 'free'
where subscription_status is null
   or subscription_status not in ('free', 'active', 'past_due', 'canceled');

alter table public.profiles
  drop constraint if exists profiles_subscription_status_valid;

alter table public.profiles
  add constraint profiles_subscription_status_valid
  check (subscription_status in ('free', 'active', 'past_due', 'canceled'));

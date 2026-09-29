/**
 * Who gets uncapped PulseAssist.
 *
 * This lived in two places with two different rules: the draft endpoint also
 * accepted `subscription_status === "active"` while the chat endpoint only
 * looked at the verification tier. Keep it in one place so the two can't drift.
 */

export type EntitlementProfile = {
  verification_tier?: string | null;
  subscription_status?: string | null;
};

/**
 * Subscription states that carry the entitlement.
 *
 * `subscription_status` is derived, never set by hand: sync_subscription_status()
 * recomputes it from billing_subscriptions after every Stripe webhook.
 *
 * 'past_due' is included on purpose. It means Stripe is still retrying the card,
 * and cutting someone off mid-cycle over a card that expired is a bad trade for
 * both sides. The window is bounded by Stripe's dunning schedule — when retries
 * are exhausted the subscription becomes 'unpaid' or 'canceled', both of which map
 * to 'canceled' here and end the entitlement (20260929001100).
 */
const ENTITLED_SUBSCRIPTION_STATUSES = new Set(["active", "past_due"]);

export function hasUnlimitedAi(profile: EntitlementProfile | null | undefined): boolean {
  if (!profile) return false;

  const tier = profile.verification_tier ?? "none";
  if (tier === "silver" || tier === "gold") return true;

  return ENTITLED_SUBSCRIPTION_STATUSES.has(profile.subscription_status ?? "free");
}

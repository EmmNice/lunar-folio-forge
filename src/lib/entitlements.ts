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

export function hasUnlimitedAi(profile: EntitlementProfile | null | undefined): boolean {
  if (!profile) return false;

  const tier = profile.verification_tier ?? "none";
  if (tier === "silver" || tier === "gold") return true;

  // Only an explicit 'active' row counts. Note there is no billing integration
  // yet, so in practice this is set by hand or grandfathered from before
  // subscription_status defaulted to 'free'.
  return profile.subscription_status === "active";
}

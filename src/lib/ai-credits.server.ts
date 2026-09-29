import { DAILY_AI_CREDITS } from "./limits";
import { hasUnlimitedAi } from "./entitlements";

/**
 * Shared PulseAssist credit gate for the draft and chat endpoints.
 * Server-only — import lazily from inside a handler.
 */

/** Thrown when the caller has no credits left. Matched by name in the Pulse UI. */
export const CREDITS_EXHAUSTED = "CREDITS_EXHAUSTED";

export type CreditGrant = {
  /** null for members with uncapped access, otherwise credits left after this call. */
  creditsRemaining: number | null;
  isUnlimited: boolean;
};

/**
 * Consumes one credit for `userId`, or throws CREDITS_EXHAUSTED.
 *
 * The check and the increment happen inside consume_ai_credit() so two parallel
 * requests can't both slip past the cap. Called with the service-role client
 * because the RPC is not granted to `authenticated` — the caller's identity has
 * already been established by requireSupabaseAuth.
 */
export async function consumeAiCredit(userId: string): Promise<CreditGrant> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Read the entitlement with the service role, not the caller's token:
  // subscription_status is no longer granted to `authenticated` (20260929000100),
  // so a user-token read returns a permission error instead of a row — which
  // hasUnlimitedAi() would then read as "not entitled", silently charging paying
  // and verified members for calls that should be uncapped.
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("verification_tier, subscription_status")
    .eq("id", userId)
    .single();

  if (hasUnlimitedAi(profile)) {
    return { creditsRemaining: null, isUnlimited: true };
  }
  const { data: remaining, error } = await supabaseAdmin.rpc("consume_ai_credit", {
    _user_id: userId,
    _daily_credits: DAILY_AI_CREDITS,
  });

  if (error) throw new Error(error.message);
  if (remaining === null || remaining < 0) throw new Error(CREDITS_EXHAUSTED);

  return { creditsRemaining: remaining, isUnlimited: false };
}

/**
 * Gives a reserved credit back when the AI call itself failed.
 *
 * The credit is taken before the request so parallel calls can't outrun the cap,
 * which means an OpenAI outage would otherwise bill the user for nothing.
 * Best-effort: a failed refund is logged, never surfaced, because the caller is
 * already on its way to reporting the original failure.
 */
export async function refundAiCredit(userId: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("refund_ai_credit", { _user_id: userId });
    if (error) console.error("[ai-credits] Refund failed:", error.message);
  } catch (error) {
    console.error("[ai-credits] Refund threw:", error);
  }
}

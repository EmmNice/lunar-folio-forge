import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DAILY_CREDITS = 3;

export const pulseAssistDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      content: z.string().min(1).max(1000),
      mode: z.enum(["polish", "expand", "shorten"]).default("polish"),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1. Load profile to check credits & subscription
    const { data: profile } = await supabase
      .from("profiles")
      .select("verification_tier, subscription_status, ai_credits_used, ai_credits_reset_at")
      .eq("id", userId)
      .single();

    const verificationTier = profile?.verification_tier ?? "none";
    const subscriptionStatus = (profile as any)?.subscription_status ?? "active";
    const isUnlimited =
      verificationTier !== "none" || subscriptionStatus === "active";

    if (!isUnlimited) {
      // Check 24h credit window
      const resetAt = new Date((profile as any)?.ai_credits_reset_at ?? 0);
      const now = new Date();
      const hoursSinceReset = (now.getTime() - resetAt.getTime()) / (1000 * 60 * 60);

      let creditsUsed = (profile as any)?.ai_credits_used ?? 0;
      if (hoursSinceReset >= 24) {
        // Reset
        creditsUsed = 0;
        await supabase
          .from("profiles")
          .update({ ai_credits_used: 0, ai_credits_reset_at: now.toISOString() } as any)
          .eq("id", userId);
      }

      if (creditsUsed >= DAILY_CREDITS) {
        throw new Error("CREDITS_EXHAUSTED");
      }
    }

    // 2. Call OpenAI
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("AI_NOT_CONFIGURED");
    }

    const systemPrompts: Record<string, string> = {
      polish:
        "You are PulseAssist, an elite AI writing assistant for Web3 founders, builders, and investors on The Ledger — a premium, tech-noir platform. Your job: transform the user's draft into a punchy, high-signal post (max 280 characters). Remove fluff. Add precision. Keep the voice bold and authoritative. Return ONLY the improved post text, nothing else. No quotes, no labels.",
      expand:
        "You are PulseAssist on The Ledger. Expand this draft into a fuller, richer post (max 280 characters). Add a sharp insight, provocative angle, or concrete detail. Return ONLY the post text.",
      shorten:
        "You are PulseAssist on The Ledger. Condense this into the most impactful version possible (max 280 characters). Cut ruthlessly. Keep the signal. Return ONLY the shortened text.",
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompts[data.mode] },
          { role: "user", content: data.content },
        ],
        max_tokens: 150,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error("AI_REQUEST_FAILED");
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const result = json.choices?.[0]?.message?.content?.trim() ?? "";

    // 3. Deduct credit for non-unlimited users
    if (!isUnlimited) {
      const currentUsed = (profile as any)?.ai_credits_used ?? 0;
      await supabase
        .from("profiles")
        .update({ ai_credits_used: currentUsed + 1 } as any)
        .eq("id", userId);
    }

    const creditsRemaining = isUnlimited
      ? null
      : DAILY_CREDITS - ((profile as any)?.ai_credits_used ?? 0) - 1;

    return { text: result, creditsRemaining };
  });

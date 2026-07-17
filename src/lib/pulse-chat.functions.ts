import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DAILY_CREDITS = 3;

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(2000),
});

export const pulseAssistChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      messages: z.array(MessageSchema).min(1).max(40),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1. Load profile for credit check
    const { data: profile } = await supabase
      .from("profiles")
      .select("verification_tier, subscription_status, ai_credits_used, ai_credits_reset_at")
      .eq("id", userId)
      .single();

    const verificationTier = profile?.verification_tier ?? "none";
    const isUnlimited = verificationTier !== "none";

    if (!isUnlimited) {
      const resetAt = new Date((profile as any)?.ai_credits_reset_at ?? 0);
      const now = new Date();
      const hoursSinceReset = (now.getTime() - resetAt.getTime()) / (1000 * 60 * 60);

      let creditsUsed = (profile as any)?.ai_credits_used ?? 0;
      if (hoursSinceReset >= 24) {
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
    if (!apiKey) throw new Error("AI_NOT_CONFIGURED");

    const system = `You are PulseAssist — the elite AI writing partner embedded in The Ledger, a premium, tech-noir platform for Web3 builders, founders, and investors.

Your job: help users craft punchy, high-signal posts, sharpen their thinking, write pitch narratives, and produce daily status updates that resonate with other builders.

Personality: sharp, concise, no corporate fluff. You think like a technical founder — direct, precise, a little irreverent.

Capabilities you help with:
- Writing & polishing status card content (max 280 chars for cards)
- Drafting pitch narratives and investor updates
- Brainstorming product positioning
- Sharpening technical announcements

When you write post content that could become a status card, keep it under 280 characters. Signal clearly when text is card-ready.

Format: use plain text. Be concise. Lead with value. No unnecessary preamble.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          ...data.messages,
        ],
        max_tokens: 400,
        temperature: 0.75,
      }),
    });

    if (!response.ok) throw new Error("AI_REQUEST_FAILED");

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = json.choices?.[0]?.message?.content?.trim() ?? "";

    // 3. Deduct credit
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

    return { reply, creditsRemaining, isUnlimited };
  });

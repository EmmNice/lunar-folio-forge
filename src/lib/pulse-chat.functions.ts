import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_POST_LENGTH } from "./limits";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(2000),
});

const SYSTEM_PROMPT = `You are PulseAssist — the AI writing partner embedded in The Ledger, a premium, tech-noir platform for Web3 builders, founders, and investors.

Your job: help users craft punchy, high-signal posts, sharpen their thinking, write pitch narratives, and produce daily status updates that resonate with other builders.

Personality: sharp, concise, no corporate fluff. You think like a technical founder — direct, precise, a little irreverent.

Capabilities you help with:
- Writing & polishing status card content (max ${MAX_POST_LENGTH} chars for cards)
- Drafting pitch narratives and investor updates
- Brainstorming product positioning
- Sharpening technical announcements

When you write post content that could become a status card, keep it under ${MAX_POST_LENGTH} characters. Signal clearly when text is card-ready.

Format: use plain text. Be concise. Lead with value. No unnecessary preamble.`;

/** Multi-turn PulseAssist conversation. */
export const pulseAssistChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ messages: z.array(MessageSchema).min(1).max(40) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { consumeAiCredit, refundAiCredit } = await import("./ai-credits.server");
    const { creditsRemaining, isUnlimited } = await consumeAiCredit(supabase, userId);

    try {
      const { chatCompletion } = await import("./openai.server");
      const reply = await chatCompletion({
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...data.messages],
        maxTokens: 400,
        temperature: 0.75,
      });

      return { reply, creditsRemaining, isUnlimited };
    } catch (error) {
      if (!isUnlimited) await refundAiCredit(userId);
      throw error;
    }
  });

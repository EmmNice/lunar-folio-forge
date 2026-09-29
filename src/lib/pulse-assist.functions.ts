import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_POST_LENGTH } from "./limits";

const MODE_PROMPTS: Record<"polish" | "expand" | "shorten", string> = {
  polish: `Transform the user's draft into a punchy, high-signal post of at most ${MAX_POST_LENGTH} characters. Remove fluff. Add precision. Keep the voice bold and authoritative.`,
  expand: `Expand this draft into a fuller, richer post of at most ${MAX_POST_LENGTH} characters. Add a sharp insight, provocative angle, or concrete detail.`,
  shorten: `Condense this into the most impactful version possible, at most ${MAX_POST_LENGTH} characters. Cut ruthlessly. Keep the signal.`,
};

const PERSONA =
  "You are PulseAssist, the AI writing assistant inside The Ledger — a premium, " +
  "tech-noir platform for Web3 founders, builders, and investors. " +
  "Return ONLY the post text: no quotes, no labels, no preamble.";

/** Rewrite a draft status card in one of three modes. */
export const pulseAssistDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        content: z.string().min(1).max(1000),
        mode: z.enum(["polish", "expand", "shorten"]).default("polish"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;

    const { consumeAiCredit, refundAiCredit } = await import("./ai-credits.server");
    const { creditsRemaining, isUnlimited } = await consumeAiCredit(userId);

    try {
      const { chatCompletion } = await import("./openai.server");
      const text = await chatCompletion({
        messages: [
          { role: "system", content: `${PERSONA}\n\n${MODE_PROMPTS[data.mode]}` },
          { role: "user", content: data.content },
        ],
        maxTokens: 150,
        temperature: 0.7,
      });

      return { text, creditsRemaining };
    } catch (error) {
      if (!isUnlimited) await refundAiCredit(userId);
      throw error;
    }
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DAILY_CONVERSATION_LIMIT } from "./limits";

/**
 * Find-or-create a conversation with another user.
 *
 * Either party can resume an existing conversation at any time. Starting a new
 * one costs one of DAILY_CONVERSATION_LIMIT slots per UTC day. The Ledger has no
 * follow graph, so there is no mutual-follow bypass.
 *
 * `conversations` intentionally has no INSERT policy — creation is gated here and
 * performed with the service role.
 */
export const startConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ recipientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const recipientId = data.recipientId;

    if (recipientId === userId) {
      throw new Error("You cannot message yourself.");
    }

    // conversations stores the participant pair sorted, so lookups are one query.
    const [userA, userB] = [userId, recipientId].sort();

    const existing = await supabase
      .from("conversations")
      .select("id")
      .eq("user_a", userA)
      .eq("user_b", userB)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) return { conversationId: existing.data.id, created: false };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Checks the cap and increments in one statement, so firing requests in
    // parallel can't overshoot the daily limit.
    const slot = await supabaseAdmin.rpc("claim_conversation_slot", {
      _user_id: userId,
      _daily_limit: DAILY_CONVERSATION_LIMIT,
    });
    if (slot.error) throw new Error(slot.error.message);
    if (!slot.data) {
      throw new Error(
        `You've used all ${DAILY_CONVERSATION_LIMIT} new conversation requests for today. Try again tomorrow.`,
      );
    }

    const insert = await supabaseAdmin
      .from("conversations")
      .insert({ user_a: userA, user_b: userB, initiated_by: userId })
      .select("id")
      .single();
    if (insert.error) throw new Error(insert.error.message);

    return { conversationId: insert.data.id, created: true };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DAILY_LIMIT = 3;

/**
 * Find-or-create a conversation with another user.
 *
 * Gating:
 *   - Existing conversation: return it (either party can resume any time).
 *   - New conversation: allowed if mutual follow OR sender has started
 *     fewer than DAILY_LIMIT new conversations today (UTC).
 */
export const startConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ recipientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const recipientId = data.recipientId;
    if (recipientId === userId) {
      throw new Error("You cannot message yourself.");
    }

    const [a, b] = [userId, recipientId].sort();

    // 1) existing?
    const existing = await supabase
      .from("conversations")
      .select("id")
      .eq("user_a", a)
      .eq("user_b", b)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) return { conversationId: existing.data.id, created: false };

    // 2) mutual-follow check
    const follows = await supabase
      .from("follows")
      .select("follower_id, following_id")
      .in("follower_id", [userId, recipientId])
      .in("following_id", [userId, recipientId]);
    if (follows.error) throw new Error(follows.error.message);
    const mutual =
      follows.data.some(
        (f) => f.follower_id === userId && f.following_id === recipientId,
      ) &&
      follows.data.some(
        (f) => f.follower_id === recipientId && f.following_id === userId,
      );

    // 3) daily-quota check (uses service role for the atomic upsert)
    if (!mutual) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const today = new Date().toISOString().slice(0, 10);
      const countRow = await supabaseAdmin
        .from("daily_request_counts")
        .select("count")
        .eq("user_id", userId)
        .eq("day", today)
        .maybeSingle();
      const used = countRow.data?.count ?? 0;
      if (used >= DAILY_LIMIT) {
        throw new Error(
          `You've used all ${DAILY_LIMIT} new conversation requests for today. Follow each other to remove the limit.`,
        );
      }
      const upsert = await supabaseAdmin
        .from("daily_request_counts")
        .upsert({ user_id: userId, day: today, count: used + 1 });
      if (upsert.error) throw new Error(upsert.error.message);
    }

    // 4) create the conversation using service role (conversations has no INSERT
    //    policy — creation is gated here on the server).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const insert = await supabaseAdmin
      .from("conversations")
      .insert({ user_a: a, user_b: b, initiated_by: userId })
      .select("id")
      .single();
    if (insert.error) throw new Error(insert.error.message);
    return { conversationId: insert.data.id, created: true };
  });

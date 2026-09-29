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

    // DM cloaking was a display-only setting: the profile page hid the Message
    // button, but this function never looked at the column, so anyone could open
    // a thread with a cloaked member by calling it directly. A privacy toggle
    // that only removes a button is not a privacy toggle.
    //
    // Read with the admin client — account_status is no longer granted to
    // `authenticated`, and dm_cloaking_enabled is fetched alongside it.
    const { data: parties, error: partiesErr } = await supabaseAdmin
      .from("profiles")
      .select("id, dm_cloaking_enabled, account_status, verification_tier")
      .in("id", [userId, recipientId]);
    if (partiesErr) throw new Error(partiesErr.message);

    const me = parties?.find((p) => p.id === userId);
    const them = parties?.find((p) => p.id === recipientId);
    if (!them) throw new Error("That member no longer exists.");

    if (me?.account_status !== "active") {
      throw new Error("Your account cannot start new conversations right now.");
    }

    if (them.dm_cloaking_enabled) {
      const viewerTier = me?.verification_tier ?? "none";
      if (viewerTier !== "silver" && viewerTier !== "gold") {
        throw new Error("This member only accepts messages from verified builders.");
      }
    }

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

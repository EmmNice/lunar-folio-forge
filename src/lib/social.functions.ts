import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Blocking.
 *
 * Follow, unfollow, mute and unmute are all plain RLS-scoped writes from the
 * browser (see lib/social.ts) — the policies already restrict every one of them to
 * the caller's own rows, so routing them through a server function would add a
 * network hop and no safety.
 *
 * Blocking is the exception, and only because of one detail: the `follows` DELETE
 * policy is `auth.uid() = follower_id`, so a member can drop their own follow but
 * not somebody else's. Blocking has to sever *both* directions — leaving the other
 * person still following you would mean a block that hides their posts from you
 * while your own keep arriving in their feed. That reverse delete needs the admin
 * client, so it happens here.
 */

const targetSchema = z.object({ targetId: z.string().uuid() });

export const blockMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => targetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { targetId } = data;

    // Also enforced by the no_self_block CHECK constraint; caught here so the
    // member gets a sentence instead of a constraint violation.
    if (targetId === userId) {
      throw new Error("You cannot block yourself.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const target = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", targetId)
      .maybeSingle();
    if (target.error) throw new Error(target.error.message);
    if (!target.data) throw new Error("That member no longer exists.");

    // Idempotent: blocking someone already blocked is a no-op, not an error. The
    // UI can be out of date (another tab, a stale page) and that shouldn't fail.
    const insert = await supabaseAdmin
      .from("blocks")
      .upsert(
        { blocker_id: userId, blocked_id: targetId },
        { onConflict: "blocker_id,blocked_id" },
      );
    if (insert.error) throw new Error(insert.error.message);

    /*
     * Sever the follow graph in both directions.
     *
     * Two separate deletes rather than one `.or()`: the filter has to be exactly
     * these two pairs. An `or` of four columns would also match unrelated rows
     * where, say, the blocker follows a third party who happens to follow the
     * blocked member.
     */
    const [mine, theirs] = await Promise.all([
      supabaseAdmin.from("follows").delete().eq("follower_id", userId).eq("following_id", targetId),
      supabaseAdmin.from("follows").delete().eq("follower_id", targetId).eq("following_id", userId),
    ]);
    if (mine.error) throw new Error(mine.error.message);
    if (theirs.error) throw new Error(theirs.error.message);

    return { blocked: true };
  });

export const unblockMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => targetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Unblocking needs no elevated access — the DELETE policy on `blocks` already
    // scopes it to your own rows, so this runs as the member. Unblocking does not
    // restore the follows that blocking broke: re-following is a decision, and
    // silently reinstating it would be a surprise.
    const { error } = await supabase
      .from("blocks")
      .delete()
      .eq("blocker_id", userId)
      .eq("blocked_id", data.targetId);
    if (error) throw new Error(error.message);

    return { blocked: false };
  });

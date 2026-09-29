import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Account deletion.
 *
 * There was no way for a member to delete their own account. `account_status`
 * exists but is moderation-only, so the only route out was asking an
 * administrator — which is not a privacy posture, it is an absence of one.
 *
 * Deleting the auth user is enough to remove everything: `profiles.id` references
 * `auth.users` with ON DELETE CASCADE, and posts, comments, likes, reposts,
 * follows, blocks, mutes, bookmarks, projects, messages and notifications all
 * cascade from `profiles`. Doing it in that order rather than deleting rows by hand
 * means a table added later is covered by its own foreign key instead of by
 * remembering to add it to a list here.
 */

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        /** The member types their own handle. Guards against a misclick, nothing more. */
        confirmHandle: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: me, error: meError } = await supabaseAdmin
      .from("profiles")
      .select("id, handle")
      .eq("id", userId)
      .maybeSingle();
    if (meError) throw new Error(meError.message);
    if (!me) throw new Error("Your profile no longer exists.");

    // Compared case-insensitively: the confirmation is a speed bump, and failing it
    // on capitalisation would only teach people to paste without reading.
    if (data.confirmHandle.trim().toLowerCase() !== me.handle.toLowerCase()) {
      throw new Error("That username doesn't match your account.");
    }

    /*
     * Refuse to delete the last administrator.
     *
     * Not a permission check — an admin is welcome to leave — but deleting the only
     * account that can review reports and verification requests would strand the
     * platform with no way to moderate it and no way back in. The fix is to promote
     * someone first, which the error says.
     */
    const { data: roles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["admin", "super_admin"]);
    if (rolesError) throw new Error(rolesError.message);

    const admins = roles ?? [];
    const iAmAdmin = admins.some((r) => r.user_id === userId);
    if (iAmAdmin && new Set(admins.map((r) => r.user_id)).size <= 1) {
      throw new Error(
        "You're the only administrator. Promote another admin before deleting your account.",
      );
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);

    return { deleted: true };
  });

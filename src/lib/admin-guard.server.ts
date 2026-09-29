import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

/**
 * Admin authorization and the audit trail, in one place.
 *
 * Server-only — import lazily from inside a handler.
 */

/**
 * Throws unless the caller is an admin.
 *
 * The check runs against the database with the *caller's own* token, so it is a
 * real authorization boundary and not something the browser can talk its way
 * past. is_admin() is the caller-scoped helper granted to `authenticated`;
 * has_role() is service_role-only and returns a permission error under a user
 * token that reads misleadingly like "not an admin".
 */
export async function requireAdmin(supabase: SupabaseClient<Database>): Promise<void> {
  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error) throw new Error(`Admin check failed: ${error.message}`);
  if (!isAdmin) throw new Error("Forbidden: Admin only.");
}

export type AdminActionTarget = "profile" | "post" | "comment" | "report" | "verification_request";

/**
 * Appends to the admin_actions log.
 *
 * Badge grants, suspensions and content removal used to leave no trace at all —
 * reviewApplication even had the reviewer's id in hand and discarded it. Written
 * with the service role because admin_actions has no INSERT policy: a log the
 * actor can rewrite is not a log.
 *
 * Deliberately best-effort. Failing to write the audit row must not roll back a
 * moderation action that has already happened — a ban that half-applied because
 * logging failed would be worse than a missing log line.
 */
export async function recordAdminAction(input: {
  actorId: string;
  action: string;
  targetType: AdminActionTarget;
  targetId: string | null;
  detail?: Record<string, Json>;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("admin_actions").insert({
      actor_id: input.actorId,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      detail: input.detail ?? {},
    });
    if (error) console.error("[admin-audit] insert failed:", error.message);
  } catch (error) {
    console.error("[admin-audit] insert threw:", error);
  }
}

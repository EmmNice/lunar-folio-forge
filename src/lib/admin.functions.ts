import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { REPORT_QUEUE_PAGE_SIZE, AUDIT_LOG_PAGE_SIZE } from "./limits";

/**
 * Admin panel backend.
 *
 * Every function here re-checks admin rights against the database with the
 * caller's own token before the service-role client touches anything, and every
 * mutation writes an admin_actions row. The hostname gate in admin.tsx only
 * hides the UI; this is where the authority actually lives.
 */

/**
 * Set a member's verification tier.
 *
 * This used to be a direct `profiles.update` from the browser, which quietly did
 * nothing: the only UPDATE policy on profiles was `auth.uid() = id`, so an admin
 * editing someone else's row matched zero rows and RLS reported no error. The
 * panel then showed a success toast for a change that never happened.
 */
export const setVerificationTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        profileId: z.string().uuid(),
        tier: z.enum(["none", "silver", "gold"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { requireAdmin, recordAdminAction } = await import("./admin-guard.server");
    await requireAdmin(supabase);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: before } = await supabaseAdmin
      .from("profiles")
      .select("verification_tier")
      .eq("id", data.profileId)
      .maybeSingle();

    const { data: updated, error } = await supabaseAdmin
      .from("profiles")
      .update({ verification_tier: data.tier })
      .eq("id", data.profileId)
      .select("id")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Member not found.");

    await recordAdminAction({
      actorId: userId,
      action: data.tier === "none" ? "verification_tier.revoke" : "verification_tier.grant",
      targetType: "profile",
      targetId: data.profileId,
      detail: { from: before?.verification_tier ?? null, to: data.tier },
    });

    return { ok: true, tier: data.tier };
  });

/**
 * Member directory for the admin panel.
 *
 * Moved off the browser's own query because the member list needs
 * `account_status`, which is no longer readable by `authenticated` (see
 * 20260929000100 — those columns used to be world-readable). It also means the
 * directory is behind a server-side admin check rather than a client `isAdmin`
 * flag in front of an ordinary RLS-scoped select.
 */
export const listMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { requireAdmin } = await import("./admin-guard.server");
    await requireAdmin(supabase);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, handle, display_name, avatar_url, verification_tier, company_name, role_type, onboarding_completed, account_status, created_at",
      )
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    // Which members hold a role, so the panel can hide the moderation controls
    // that setAccountStatus would refuse anyway.
    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id");
    const admins = new Set((roles ?? []).map((r) => r.user_id));

    return (data ?? []).map((member) => ({ ...member, is_admin: admins.has(member.id) }));
  });

/**
 * Restrict, ban or reinstate a member.
 *
 * Before this, the strongest sanction an admin had was revoking a verification
 * badge — there was no way to stop an abusive account from posting, commenting,
 * messaging or pitching. The enforcement itself is in RLS (actor_is_active() on
 * every content INSERT policy, and can_view_post() hiding a banned member's
 * posts), so it cannot be sidestepped by calling the REST API directly.
 *
 * Admins cannot moderate themselves or another admin: losing the last working
 * admin account to a mis-click is not a recoverable state from inside the app.
 */
export const setAccountStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        profileId: z.string().uuid(),
        status: z.enum(["active", "restricted", "banned"]),
        reason: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { requireAdmin, recordAdminAction } = await import("./admin-guard.server");
    await requireAdmin(supabase);

    if (data.profileId === userId) {
      throw new Error("You cannot change your own account status.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.profileId);
    if ((targetRoles?.length ?? 0) > 0) {
      throw new Error("That member is an admin. Remove their admin role first.");
    }

    const { data: before } = await supabaseAdmin
      .from("profiles")
      .select("account_status")
      .eq("id", data.profileId)
      .maybeSingle();

    const { data: updated, error } = await supabaseAdmin
      .from("profiles")
      .update({ account_status: data.status })
      .eq("id", data.profileId)
      .select("id")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Member not found.");

    await recordAdminAction({
      actorId: userId,
      action: `account_status.${data.status}`,
      targetType: "profile",
      targetId: data.profileId,
      detail: {
        from: before?.account_status ?? null,
        to: data.status,
        reason: data.reason ?? null,
      },
    });

    return { ok: true, status: data.status };
  });

/** The moderation queue: open reports, newest first. */
export const listReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { requireAdmin } = await import("./admin-guard.server");
    await requireAdmin(supabase);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("reports")
      .select(
        `
        id, reason, status, created_at, reviewed_at, resolution_note,
        reporter:profiles!reports_reporter_id_fkey(id, handle, display_name),
        post:posts!reports_post_id_fkey(
          id, content, background, visibility, created_at,
          author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, account_status)
        )
      `,
      )
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(REPORT_QUEUE_PAGE_SIZE);

    if (error) throw new Error(error.message);
    return data ?? [];
  });

/**
 * Resolve a report, optionally removing the post it was filed against.
 *
 * `reports` rows have been accumulating since launch behind a toast that says
 * "the moderators will review" — nothing read the table and there was no way to
 * act on one. Removing the post is done here rather than as a separate call so
 * the removal and the resolution cannot end up disagreeing.
 */
export const resolveReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        reportId: z.string().uuid(),
        resolution: z.enum(["actioned", "dismissed"]),
        removePost: z.boolean().default(false),
        note: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { requireAdmin, recordAdminAction } = await import("./admin-guard.server");
    await requireAdmin(supabase);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: report, error: fetchErr } = await supabaseAdmin
      .from("reports")
      .select("id, post_id, status")
      .eq("id", data.reportId)
      .maybeSingle();

    if (fetchErr) throw new Error(fetchErr.message);
    if (!report) throw new Error("Report not found.");
    if (report.status !== "open") throw new Error("That report has already been resolved.");

    let postRemoved = false;
    if (data.removePost && report.post_id) {
      const { error: delErr } = await supabaseAdmin.from("posts").delete().eq("id", report.post_id);
      if (delErr) throw new Error(`Could not remove the post: ${delErr.message}`);
      postRemoved = true;

      await recordAdminAction({
        actorId: userId,
        action: "post.remove",
        targetType: "post",
        targetId: report.post_id,
        detail: { via: "report", reportId: data.reportId },
      });
    }

    const { error: updateErr } = await supabaseAdmin
      .from("reports")
      .update({
        status: data.resolution,
        reviewed_at: new Date().toISOString(),
        reviewed_by: userId,
        resolution_note: data.note ?? null,
      })
      .eq("id", data.reportId);
    if (updateErr) throw new Error(updateErr.message);

    // Every other open report on the same post is now resolved too — otherwise
    // a post reported by ten people needs ten identical decisions.
    let alsoResolved = 0;
    if (report.post_id) {
      const { data: siblings } = await supabaseAdmin
        .from("reports")
        .update({
          status: data.resolution,
          reviewed_at: new Date().toISOString(),
          reviewed_by: userId,
          resolution_note: data.note ?? "Resolved with another report on the same post.",
        })
        .eq("post_id", report.post_id)
        .eq("status", "open")
        .select("id");
      alsoResolved = siblings?.length ?? 0;
    }

    await recordAdminAction({
      actorId: userId,
      action: `report.${data.resolution}`,
      targetType: "report",
      targetId: data.reportId,
      detail: { postRemoved, note: data.note ?? null, alsoResolved },
    });

    return { ok: true, postRemoved, alsoResolved };
  });

/** Remove any member's post. Used from the moderation queue and the member view. */
export const removePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ postId: z.string().uuid(), reason: z.string().max(500).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { requireAdmin, recordAdminAction } = await import("./admin-guard.server");
    await requireAdmin(supabase);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: post } = await supabaseAdmin
      .from("posts")
      .select("id, author_id, content")
      .eq("id", data.postId)
      .maybeSingle();
    if (!post) throw new Error("Post not found.");

    const { error } = await supabaseAdmin.from("posts").delete().eq("id", data.postId);
    if (error) throw new Error(error.message);

    await recordAdminAction({
      actorId: userId,
      action: "post.remove",
      targetType: "post",
      targetId: data.postId,
      detail: {
        authorId: post.author_id,
        reason: data.reason ?? null,
        // Keep an excerpt so the log still means something after the row is gone.
        excerpt: (post.content ?? "").slice(0, 120),
      },
    });

    return { ok: true };
  });

/** The audit trail, newest first. */
export const listAdminActions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { requireAdmin } = await import("./admin-guard.server");
    await requireAdmin(supabase);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("admin_actions")
      .select(
        `
        id, action, target_type, target_id, detail, created_at,
        actor:profiles!admin_actions_actor_id_fkey(id, handle, display_name)
      `,
      )
      .order("created_at", { ascending: false })
      .limit(AUDIT_LOG_PAGE_SIZE);

    if (error) throw new Error(error.message);
    return data ?? [];
  });

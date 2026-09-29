import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Set a member's verification tier from the admin panel.
 *
 * This used to be a direct `profiles.update` from the browser, which quietly did
 * nothing: the only UPDATE policy on profiles was `auth.uid() = id`, so an admin
 * editing someone else's row matched zero rows and RLS reported no error. The
 * panel then showed a success toast for a change that never happened.
 *
 * Doing it here means the admin role is checked against the database with the
 * caller's own token before the service-role client touches the row.
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
    const { supabase } = context;

    // is_admin() is the caller-scoped helper granted to `authenticated`;
    // has_role() is service_role-only and errors under the user's token.
    const { data: isAdmin, error: adminErr } = await supabase.rpc("is_admin");
    if (adminErr) throw new Error(`Admin check failed: ${adminErr.message}`);
    if (!isAdmin) throw new Error("Forbidden: Admin only.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: updated, error } = await supabaseAdmin
      .from("profiles")
      .update({ verification_tier: data.tier })
      .eq("id", data.profileId)
      .select("id")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Member not found.");

    return { ok: true, tier: data.tier };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { MAX_SHIP_DESC_LENGTH } from "./limits";
import { wantsNotification } from "./notification-prefs";

function approvalEmailHtml(tierLabel: string, ctaUrl: string) {
  const isSilver = tierLabel === "Silver Builder";

  const badge = isSilver
    ? `<span style="display:inline-flex;align-items:center;gap:6px;background:rgba(148,163,184,0.12);border:1px solid rgba(148,163,184,0.30);border-radius:100px;padding:5px 12px;font-size:12px;font-weight:600;color:#94a3b8;">&#10022; Silver Verified</span>`
    : `<span style="display:inline-flex;align-items:center;gap:6px;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.35);border-radius:100px;padding:5px 12px;font-size:12px;font-weight:600;color:#fbbf24;">&#10022; Gold Verified</span>`;

  const perks = isSilver
    ? [
        ["&#9889;", "Unlimited AI credits", "PulseAssist has no daily cap for Silver builders."],
        [
          "&#128225;",
          "Signal feed visibility",
          "your posts surface in the highest-signal tab on the platform.",
        ],
        ["&#128304;", "Silver badge", "displayed on your profile and every post you publish."],
      ]
    : [
        ["&#9854;", "Unlimited AI & pitch credits", "every PulseAssist and pitch tool, no limits."],
        [
          "&#127760;",
          "Premium network access",
          "connect with verified founders and investors directly.",
        ],
        ["&#129351;", "Gold badge", "the highest prestige tier on The Ledger."],
      ];

  const perkRows = perks
    .map(
      ([icon, title, detail]) => `
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <span style="font-size:16px;line-height:1;">${icon}</span>
          <span style="font-size:14px;color:rgba(245,245,246,0.80);"><strong style="color:#F5F5F6;">${title}</strong> — ${detail}</span>
        </div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0B0B0C;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#F5F5F6;">
  <div style="max-width:560px;margin:0 auto;padding:48px 24px;">

    ${wordmark()}

    <div style="margin-bottom:28px;">${badge}</div>

    <h1 style="margin:0 0 12px;font-size:26px;font-weight:700;letter-spacing:-0.7px;line-height:1.25;color:#F5F5F6;">
      Congratulations — you're verified.
    </h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:rgba(245,245,246,0.70);">
      Your application for <strong style="color:#F5F5F6;">${tierLabel}</strong> verification on The Ledger
      has been approved. Welcome to the network of founders and builders who are actively shipping.
    </p>

    <div style="background:#1A1A1E;border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:24px;margin-bottom:32px;">
      <p style="margin:0 0 16px;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#6B6B7A;">
        What you've unlocked
      </p>
      <div style="display:flex;flex-direction:column;gap:12px;">${perkRows}</div>
    </div>

    <a href="${ctaUrl}"
       style="display:inline-block;background:#F5F5F6;color:#0B0B0C;font-size:14px;font-weight:600;text-decoration:none;border-radius:12px;padding:12px 24px;letter-spacing:-0.2px;">
      Open The Ledger &rarr;
    </a>

    ${footer()}
  </div>
</body>
</html>`;
}

function rejectionEmailHtml(ctaUrl: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0B0B0C;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#F5F5F6;">
  <div style="max-width:560px;margin:0 auto;padding:48px 24px;">

    ${wordmark()}

    <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;letter-spacing:-0.6px;color:#F5F5F6;">
      Update on your verification application
    </h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:rgba(245,245,246,0.70);">
      Thank you for applying for verification on The Ledger. After reviewing your submission,
      we were unable to verify your account with the details provided at this time.
    </p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:rgba(245,245,246,0.70);">
      Please make sure you provide accurate information and meet all the required criteria
      for your chosen track — your GitHub profile should show active public repositories,
      or your fund/company should be publicly verifiable.
    </p>
    <p style="margin:0 0 32px;font-size:15px;line-height:1.65;color:rgba(245,245,246,0.70);">
      <strong style="color:#F5F5F6;">You are welcome to reapply at any time.</strong> Simply visit your
      profile, open the Verification tab, and submit updated credentials.
    </p>

    <a href="${ctaUrl}"
       style="display:inline-block;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);color:#F5F5F6;font-size:14px;font-weight:600;text-decoration:none;border-radius:12px;padding:12px 24px;letter-spacing:-0.2px;">
      Back to The Ledger &rarr;
    </a>

    ${footer()}
  </div>
</body>
</html>`;
}

function wordmark() {
  return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:40px;">
      <div style="width:32px;height:32px;background:#F5F5F6;border-radius:8px;display:flex;align-items:center;justify-content:center;">
        <span style="font-size:14px;font-weight:800;color:#0B0B0C;letter-spacing:-0.5px;">L</span>
      </div>
      <span style="font-size:16px;font-weight:700;letter-spacing:-0.4px;color:#F5F5F6;">The Ledger</span>
    </div>`;
}

function footer() {
  return `<p style="margin:40px 0 0;font-size:12px;color:#3A3A44;">The Ledger · For founders who ship.</p>`;
}

/** Apply for Silver (builder) or Gold (investor) verification. */
export const submitVerificationApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        tier: z.enum(["silver", "gold"]),
        // Links are accepted as free text and checked by a human reviewer.
        github_url: z.string().max(500).optional().or(z.literal("")),
        deployed_contract_address: z.string().max(200).optional().or(z.literal("")),
        live_project_url: z.string().max(500).optional().or(z.literal("")),
        recent_ship_desc: z.string().max(MAX_SHIP_DESC_LENGTH).optional().or(z.literal("")),
        fund_or_company_name: z.string().max(120).optional().or(z.literal("")),
        portfolio_url: z.string().max(500).optional().or(z.literal("")),
        linkedin_or_x_url: z.string().max(500).optional().or(z.literal("")),
        invite_code: z.string().max(60).optional().or(z.literal("")),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    if (data.tier === "silver" && !data.github_url) {
      throw new Error("A GitHub URL is required for Silver Builder verification.");
    }
    if (data.tier === "gold" && !data.fund_or_company_name) {
      throw new Error("Fund or company name is required for Gold Investor verification.");
    }

    const { data: existing } = await supabase
      .from("verification_requests")
      .select("id, status")
      .eq("user_id", userId)
      .eq("tier", data.tier)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.status === "pending") {
      throw new Error("You already have a pending application for this tier.");
    }

    const { error } = await supabase.from("verification_requests").insert({
      user_id: userId,
      tier: data.tier,
      // link_primary/link_secondary predate the per-track columns below and are
      // still populated so older admin views keep working.
      link_primary:
        data.tier === "silver"
          ? (data.github_url ?? "")
          : (data.portfolio_url ?? data.fund_or_company_name ?? ""),
      link_secondary:
        data.tier === "silver" ? (data.live_project_url ?? null) : (data.linkedin_or_x_url ?? null),
      github_url: data.github_url || null,
      deployed_contract_address: data.deployed_contract_address || null,
      live_project_url: data.live_project_url || null,
      recent_ship_desc: data.recent_ship_desc || null,
      fund_or_company_name: data.fund_or_company_name || null,
      portfolio_url: data.portfolio_url || null,
      linkedin_or_x_url: data.linkedin_or_x_url || null,
      invite_code: data.invite_code || null,
    });
    if (error) throw new Error(error.message);

    return { ok: true };
  });

/**
 * Assert the caller holds the admin role.
 *
 * Uses the caller's own token, so this is a real server-side check and not
 * something the browser can talk its way past.
 */
async function requireAdmin(supabase: SupabaseClient<Database>) {
  // is_admin() is scoped to the caller and granted to `authenticated`.
  // has_role() is service_role-only, so calling it with the user's token
  // returned a permission error that read as "not an admin".
  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error) throw new Error(`Admin check failed: ${error.message}`);
  if (!isAdmin) throw new Error("Forbidden: Admin only.");
}

/** Admin: list applications awaiting review. */
export const listPendingApplications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    await requireAdmin(supabase);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("verification_requests")
      .select(
        `
        id, tier, status, created_at,
        github_url, deployed_contract_address, live_project_url, recent_ship_desc,
        fund_or_company_name, portfolio_url, linkedin_or_x_url, invite_code,
        link_primary, link_secondary,
        profiles!verification_requests_user_id_fkey(
          id, handle, display_name, avatar_url, company_name
        )
      `,
      )
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  });

/**
 * Admin: approve or reject an application.
 *
 * Approving is what sets profiles.verification_tier — members cannot write that
 * column themselves (see the guard trigger in 20260928000200).
 */
export const reviewApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        applicationId: z.string().uuid(),
        action: z.enum(["approve", "reject"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireAdmin(supabase);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: application, error: fetchErr } = await supabaseAdmin
      .from("verification_requests")
      .select("id, tier, user_id, status")
      .eq("id", data.applicationId)
      .single();

    if (fetchErr || !application) throw new Error("Application not found.");
    if (application.status !== "pending") throw new Error("Application is no longer pending.");

    const approved = data.action === "approve";
    const newStatus = approved ? "approved" : "rejected";

    const { error: updateErr } = await supabaseAdmin
      .from("verification_requests")
      .update({ status: newStatus, reviewed_at: new Date().toISOString() })
      .eq("id", data.applicationId);
    if (updateErr) throw new Error(updateErr.message);

    if (approved) {
      const { error: tierErr } = await supabaseAdmin
        .from("profiles")
        .update({ verification_tier: application.tier })
        .eq("id", application.user_id);
      if (tierErr) throw new Error(tierErr.message);
    }

    // In-app notification, so the decision shows in the bell straight away.
    const { error: notifyErr } = await supabaseAdmin.from("notifications").insert({
      user_id: application.user_id,
      actor_id: null,
      type: approved ? "verification_approved" : "verification_rejected",
      post_id: null,
      metadata: { tier: application.tier },
    });
    if (notifyErr) console.warn("[verification] Notification insert failed:", notifyErr.message);

    const emailed = await emailDecision(application.user_id, application.tier, approved);

    return { ok: true, newStatus, emailed };
  });

/** Emails the applicant. Returns whether it actually went out. */
async function emailDecision(
  applicantId: string,
  tier: string,
  approved: boolean,
): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("notification_prefs")
      .eq("id", applicantId)
      .maybeSingle();
    if (!wantsNotification(profile?.notification_prefs, "system")) return false;

    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(applicantId);
    const email = userData?.user?.email;
    if (!email) return false;

    const { sendEmail } = await import("./email.server");
    const { appLink } = await import("./app-config.server");
    const ctaUrl = appLink("/feed");

    const result = approved
      ? await sendEmail(
          email,
          "[The Ledger] Congratulations! Your Verification Has Been Approved",
          approvalEmailHtml(tier === "silver" ? "Silver Builder" : "Gold Investor", ctaUrl),
        )
      : await sendEmail(
          email,
          "[The Ledger] Update on Your Verification Application",
          rejectionEmailHtml(ctaUrl),
        );

    return result.delivered;
  } catch (error) {
    // The review itself is already committed; email is best-effort.
    console.error("[verification] Decision email failed:", error);
    return false;
  }
}

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_SHIP_DESC_LENGTH } from "./limits";
import { wantsNotification } from "./notification-prefs";

/**
 * An optional http(s) link, or the empty string the forms send for "not filled in".
 *
 * Mirrors the `~* '^https?://'` CHECK constraints added in 20260929000400 so a
 * bad scheme is rejected with a sentence a person can act on rather than a
 * Postgres constraint name.
 */
function httpUrl(max: number) {
  return z
    .string()
    .max(max)
    .refine((value) => value === "" || /^https?:\/\//i.test(value), {
      message: "Links must start with http:// or https://",
    })
    .optional()
    .or(z.literal(""));
}

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

/**
 * The caller's own proof code, plus what to do with it.
 *
 * verification_proof_code is not granted to `authenticated` at the column level
 * (20260930000300) — publishing everyone's code would let one member post
 * another member's and claim their identity — so it is read with the service role
 * for the one person entitled to it.
 */
export const getVerificationProof = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("verification_proof_code")
      .eq("id", userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data?.verification_proof_code) throw new Error("Your proof code could not be loaded.");

    return { code: data.verification_proof_code };
  });

/**
 * How long a member must wait between automated checks.
 *
 * The check makes this server fetch a URL, so an unlimited button is an unlimited
 * outbound request generator with our IP attached. The bigger limit is structural
 * — the check only ever reads URLs already stored on the caller's own application,
 * which they cannot change without submitting a new one — but a cooldown also
 * stops someone hammering a third party's site through us while they edit it.
 */
const PROOF_RECHECK_COOLDOWN_MS = 60_000;

/**
 * Runs the proof check against the caller's own pending application.
 *
 * Separate from submitting, because the order people actually work in is: apply,
 * read the instructions properly, edit their GitHub bio, then want to know if it
 * worked. Without this they would have to wait for a human, or withdraw and
 * reapply into a 7-day cooldown.
 */
export const recheckVerificationProof = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ tier: z.enum(["silver", "gold"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: application } = await supabaseAdmin
      .from("verification_requests")
      .select(
        "id, tier, status, github_url, portfolio_url, linkedin_or_x_url, live_project_url, proof_checked_at, proof_verified_at",
      )
      .eq("user_id", userId)
      .eq("tier", data.tier)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!application) {
      throw new Error("You have no pending application for this tier.");
    }
    if (application.proof_verified_at) {
      // Already proved. Re-fetching a third party's site to learn what we know is
      // pointless, and re-running it could only turn a pass into a failure if they
      // have since removed the code.
      return { verified: true, detail: "Already verified.", alreadyVerified: true };
    }

    const lastCheck = application.proof_checked_at
      ? new Date(application.proof_checked_at).getTime()
      : 0;
    const waitMs = PROOF_RECHECK_COOLDOWN_MS - (Date.now() - lastCheck);
    if (waitMs > 0) {
      throw new Error(`Give it ${Math.ceil(waitMs / 1000)}s before checking again.`);
    }

    const outcome = await checkAndRecordProof(application.id, userId, data.tier, {
      githubUrl: application.github_url,
      portfolioUrl: application.portfolio_url,
      linkedinOrXUrl: application.linkedin_or_x_url,
      liveProjectUrl: application.live_project_url,
    });

    return { ...outcome, alreadyVerified: false };
  });

/**
 * Runs the check and writes the result onto the application.
 *
 * Every proof column is written with the service role. A member who could set
 * their own proof_verified_at would have defeated the whole mechanism, which is
 * why `authenticated` has no UPDATE path to this table at all — the only UPDATE
 * policy on it requires is_admin().
 */
async function checkAndRecordProof(
  applicationId: string,
  userId: string,
  tier: "silver" | "gold",
  links: {
    githubUrl: string | null;
    portfolioUrl: string | null;
    linkedinOrXUrl: string | null;
    liveProjectUrl: string | null;
  },
): Promise<{ verified: boolean; detail: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { runProofCheck } = await import("./verification-proof.server");

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("verification_proof_code")
    .eq("id", userId)
    .maybeSingle();

  const code = profile?.verification_proof_code;
  if (!code) return { verified: false, detail: "No proof code is set on this account." };

  const outcome = await runProofCheck({ tier, code, ...links });

  // proof_attempts is incremented by reading and writing rather than with a SQL
  // expression because PostgREST cannot express `col = col + 1`. The cooldown above
  // makes the race for this counter both unlikely and harmless.
  const { data: current } = await supabaseAdmin
    .from("verification_requests")
    .select("proof_attempts")
    .eq("id", applicationId)
    .maybeSingle();

  const { error } = await supabaseAdmin
    .from("verification_requests")
    .update({
      proof_checked_at: new Date().toISOString(),
      proof_attempts: (current?.proof_attempts ?? 0) + 1,
      proof_detail: outcome.detail,
      ...(outcome.verified
        ? { proof_verified_at: new Date().toISOString(), proof_method: outcome.method }
        : {}),
    })
    .eq("id", applicationId);

  if (error) {
    // The check itself succeeded; failing to record it must not look to the
    // applicant like their proof was rejected.
    console.error("[verification] Could not record proof result:", error.message);
  }

  return { verified: outcome.verified, detail: outcome.detail };
}

/** Apply for Silver (builder) or Gold (investor) verification. */
export const submitVerificationApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        tier: z.enum(["silver", "gold"]),
        // The content of each link is judged by a human reviewer, but the *shape*
        // is not a matter of opinion. These were plain `z.string().max(500)`,
        // so "javascript:..." reached the database and then an <a href> in the
        // admin's own review panel — the one session on the platform where a
        // payload would do the most damage. The DB now has a matching CHECK
        // (20260929000400); validating here is what produces a readable error
        // instead of a raw constraint violation.
        github_url: httpUrl(500),
        deployed_contract_address: z.string().max(200).optional().or(z.literal("")),
        live_project_url: httpUrl(500),
        recent_ship_desc: z.string().max(MAX_SHIP_DESC_LENGTH).optional().or(z.literal("")),
        fund_or_company_name: z.string().max(120).optional().or(z.literal("")),
        portfolio_url: httpUrl(500),
        linkedin_or_x_url: httpUrl(500),
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // account_status and the current tier are read with the service role because
    // account_status is no longer granted to `authenticated` (20260929000100).
    const { data: applicant } = await supabaseAdmin
      .from("profiles")
      .select("verification_tier, account_status")
      .eq("id", userId)
      .maybeSingle();

    if (!applicant) throw new Error("Your profile could not be loaded.");
    if (applicant.account_status !== "active") {
      throw new Error("Your account cannot submit an application right now.");
    }

    // Nothing stopped an already-verified member re-applying for the badge they
    // hold, which put a pointless row in front of a human reviewer every time.
    if (applicant.verification_tier === data.tier) {
      throw new Error(`You are already verified at the ${data.tier} tier.`);
    }
    if (applicant.verification_tier === "gold" && data.tier === "silver") {
      throw new Error("You already hold Gold verification, which supersedes Silver.");
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

    const { data: inserted, error } = await supabase
      .from("verification_requests")
      .insert({
        user_id: userId,
        tier: data.tier,
        // link_primary/link_secondary predate the per-track columns below and are
        // still populated so older admin views keep working.
        link_primary:
          data.tier === "silver"
            ? (data.github_url ?? "")
            : (data.portfolio_url ?? data.fund_or_company_name ?? ""),
        link_secondary:
          data.tier === "silver"
            ? (data.live_project_url ?? null)
            : (data.linkedin_or_x_url ?? null),
        github_url: data.github_url || null,
        deployed_contract_address: data.deployed_contract_address || null,
        live_project_url: data.live_project_url || null,
        recent_ship_desc: data.recent_ship_desc || null,
        fund_or_company_name: data.fund_or_company_name || null,
        portfolio_url: data.portfolio_url || null,
        linkedin_or_x_url: data.linkedin_or_x_url || null,
        invite_code: data.invite_code || null,
      })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);

    /*
      Check the proof straight away, so an applicant who followed the instructions
      lands in the queue already proven and a reviewer sees evidence rather than a
      claim. Best-effort on purpose: GitHub being rate-limited or a company site
      being down is not a reason to lose the application. It is re-runnable from
      the form via recheckVerificationProof.
    */
    let proof: { verified: boolean; detail: string } = {
      verified: false,
      detail: "Not checked yet.",
    };
    if (inserted?.id) {
      try {
        proof = await checkAndRecordProof(inserted.id, userId, data.tier, {
          githubUrl: data.github_url || null,
          portfolioUrl: data.portfolio_url || null,
          linkedinOrXUrl: data.linkedin_or_x_url || null,
          liveProjectUrl: data.live_project_url || null,
        });
      } catch (checkError) {
        console.error("[verification] Proof check failed after submit:", checkError);
      }
    }

    return { ok: true, proof };
  });

/** Admin: list applications awaiting review. */
export const listPendingApplications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { requireAdmin } = await import("./admin-guard.server");
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
        proof_verified_at, proof_method, proof_detail, proof_checked_at, proof_attempts,
        profiles!verification_requests_user_id_fkey(
          id, handle, display_name, avatar_url, company_name,
          created_at, skills, role_type, bio, location
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
        /*
          Set when the reviewer approves an application the automated check could
          not prove. Recorded rather than inferred, so "we established this out of
          band" and "the machine confirmed it" stay distinguishable afterwards —
          an audit trail where both look the same is not much of one.
        */
        manualProof: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { requireAdmin, recordAdminAction } = await import("./admin-guard.server");
    await requireAdmin(supabase);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: application, error: fetchErr } = await supabaseAdmin
      .from("verification_requests")
      .select("id, tier, user_id, status, proof_verified_at")
      .eq("id", data.applicationId)
      .single();

    if (fetchErr || !application) throw new Error("Application not found.");
    if (application.status !== "pending") throw new Error("Application is no longer pending.");

    const approved = data.action === "approve";
    const newStatus = approved ? "approved" : "rejected";

    /*
      The admin UI disables Approve until either the proof passed or the reviewer
      ticks the manual-vouch box. Re-checked here because a disabled button is a
      hint, not a rule: this function is reachable over HTTP by anyone holding an
      admin session, and granting a badge is exactly the action that should not
      depend on the client having rendered correctly.
    */
    const vouchedManually = approved && !application.proof_verified_at;
    if (vouchedManually && !data.manualProof) {
      throw new Error(
        "Ownership is unproven for this application. Confirm you have verified it another way before approving.",
      );
    }

    // reviewed_by was the missing half of the audit story: this handler has always
    // had the reviewer's id in hand and threw it away, so an approval was
    // recorded as having happened but not by whom.
    const { error: updateErr } = await supabaseAdmin
      .from("verification_requests")
      .update({
        status: newStatus,
        reviewed_at: new Date().toISOString(),
        reviewed_by: userId,
      })
      .eq("id", data.applicationId);
    if (updateErr) throw new Error(updateErr.message);

    if (approved) {
      const { error: tierErr } = await supabaseAdmin
        .from("profiles")
        .update({ verification_tier: application.tier })
        .eq("id", application.user_id);
      if (tierErr) throw new Error(tierErr.message);
    }

    // A manual vouch is written onto the application as proof_method 'manual', so
    // the row says who decided the account was genuine and on what basis.
    if (vouchedManually) {
      await supabaseAdmin
        .from("verification_requests")
        .update({
          proof_verified_at: new Date().toISOString(),
          proof_method: "manual",
          proof_detail: `Ownership vouched for manually by admin ${userId} — the automated check did not confirm it.`,
        })
        .eq("id", application.id);
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

    await recordAdminAction({
      actorId: userId,
      action: `verification.${newStatus}`,
      targetType: "verification_request",
      targetId: application.id,
      detail: {
        applicantId: application.user_id,
        tier: application.tier,
        // Whether the badge rested on an automated proof or a person's word.
        proof: vouchedManually ? "manual_vouch" : "automated",
      },
    });

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

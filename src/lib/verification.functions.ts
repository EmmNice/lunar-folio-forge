import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ─── Email helper (Resend REST API) ──────────────────────────────────────────
async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[Verification] RESEND_API_KEY not set — skipping email to", to);
    return;
  }
  const from = process.env.RESEND_FROM_EMAIL ?? "The Ledger <noreply@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[Verification] Resend error:", res.status, text);
    }
  } catch (e) {
    console.error("[Verification] Email send failed:", e);
  }
}

function approvalEmailHtml(tierLabel: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0B0B0C;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#F5F5F6;">
  <div style="max-width:560px;margin:0 auto;padding:48px 24px;">

    <!-- Wordmark -->
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:40px;">
      <div style="width:32px;height:32px;background:#F5F5F6;border-radius:8px;display:flex;align-items:center;justify-content:center;">
        <span style="font-size:14px;font-weight:800;color:#0B0B0C;letter-spacing:-0.5px;">L</span>
      </div>
      <span style="font-size:16px;font-weight:700;letter-spacing:-0.4px;color:#F5F5F6;">The Ledger</span>
    </div>

    <!-- Badge -->
    <div style="margin-bottom:28px;">
      ${tierLabel === "Silver Builder"
        ? `<span style="display:inline-flex;align-items:center;gap:6px;background:rgba(148,163,184,0.12);border:1px solid rgba(148,163,184,0.30);border-radius:100px;padding:5px 12px;font-size:12px;font-weight:600;color:#94a3b8;">✦ Silver Verified</span>`
        : `<span style="display:inline-flex;align-items:center;gap:6px;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.35);border-radius:100px;padding:5px 12px;font-size:12px;font-weight:600;color:#fbbf24;">✦ Gold Verified</span>`
      }
    </div>

    <h1 style="margin:0 0 12px;font-size:26px;font-weight:700;letter-spacing:-0.7px;line-height:1.25;color:#F5F5F6;">
      Congratulations — you're verified.
    </h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:rgba(245,245,246,0.70);">
      Your application for <strong style="color:#F5F5F6;">${tierLabel}</strong> verification on The Ledger
      has been approved. Welcome to the elite network of founders and builders who are actively shipping.
    </p>

    <!-- Perks -->
    <div style="background:#1A1A1E;border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:24px;margin-bottom:32px;">
      <p style="margin:0 0 16px;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#6B6B7A;">
        What you've unlocked
      </p>
      ${tierLabel === "Silver Builder" ? `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <span style="font-size:16px;line-height:1;">⚡</span>
          <span style="font-size:14px;color:rgba(245,245,246,0.80);"><strong style="color:#F5F5F6;">Unlimited AI credits</strong> — PulseAssist has no daily cap for Silver builders.</span>
        </div>
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <span style="font-size:16px;line-height:1;">📡</span>
          <span style="font-size:14px;color:rgba(245,245,246,0.80);"><strong style="color:#F5F5F6;">Signal feed visibility</strong> — your posts surface in the highest-signal tab on the platform.</span>
        </div>
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <span style="font-size:16px;line-height:1;">🔰</span>
          <span style="font-size:14px;color:rgba(245,245,246,0.80);"><strong style="color:#F5F5F6;">Silver badge</strong> — displayed on your profile and every post you publish.</span>
        </div>
      </div>` : `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <span style="font-size:16px;line-height:1;">♾️</span>
          <span style="font-size:14px;color:rgba(245,245,246,0.80);"><strong style="color:#F5F5F6;">Unlimited AI & pitch credits</strong> — every PulseAssist and pitch tool, no limits.</span>
        </div>
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <span style="font-size:16px;line-height:1;">🌐</span>
          <span style="font-size:14px;color:rgba(245,245,246,0.80);"><strong style="color:#F5F5F6;">Premium network access</strong> — connect with verified founders and investors directly.</span>
        </div>
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <span style="font-size:16px;line-height:1;">🥇</span>
          <span style="font-size:14px;color:rgba(245,245,246,0.80);"><strong style="color:#F5F5F6;">Gold badge</strong> — the highest prestige tier on The Ledger.</span>
        </div>
      </div>`}
    </div>

    <!-- CTA -->
    <a href="https://theledger.app/feed"
       style="display:inline-block;background:#F5F5F6;color:#0B0B0C;font-size:14px;font-weight:600;text-decoration:none;border-radius:12px;padding:12px 24px;letter-spacing:-0.2px;">
      Open The Ledger →
    </a>

    <p style="margin:40px 0 0;font-size:12px;color:#3A3A44;">The Ledger · For founders who ship.</p>
  </div>
</body>
</html>`;
}

function rejectionEmailHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0B0B0C;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#F5F5F6;">
  <div style="max-width:560px;margin:0 auto;padding:48px 24px;">

    <div style="display:flex;align-items:center;gap:10px;margin-bottom:40px;">
      <div style="width:32px;height:32px;background:#F5F5F6;border-radius:8px;display:flex;align-items:center;justify-content:center;">
        <span style="font-size:14px;font-weight:800;color:#0B0B0C;letter-spacing:-0.5px;">L</span>
      </div>
      <span style="font-size:16px;font-weight:700;letter-spacing:-0.4px;color:#F5F5F6;">The Ledger</span>
    </div>

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

    <a href="https://theledger.app/feed"
       style="display:inline-block;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);color:#F5F5F6;font-size:14px;font-weight:600;text-decoration:none;border-radius:12px;padding:12px 24px;letter-spacing:-0.2px;">
      Back to The Ledger →
    </a>

    <p style="margin:40px 0 0;font-size:12px;color:#3A3A44;">The Ledger · For founders who ship.</p>
  </div>
</body>
</html>`;
}

// ─── Submit verification application ─────────────────────────────────────────
export const submitVerificationApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      tier: z.enum(["silver", "gold"]),
      // Silver fields
      github_url: z.string().url().optional().or(z.literal("")),
      deployed_contract_address: z.string().max(200).optional().or(z.literal("")),
      live_project_url: z.string().url().optional().or(z.literal("")),
      recent_ship_desc: z.string().max(100).optional().or(z.literal("")),
      // Gold fields
      fund_or_company_name: z.string().max(120).optional().or(z.literal("")),
      portfolio_url: z.string().url().optional().or(z.literal("")),
      linkedin_or_x_url: z.string().url().optional().or(z.literal("")),
      invite_code: z.string().max(60).optional().or(z.literal("")),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Require at least one primary field per tier
    if (data.tier === "silver" && !data.github_url) {
      throw new Error("A GitHub URL is required for Silver Builder verification.");
    }
    if (data.tier === "gold" && !data.fund_or_company_name) {
      throw new Error("Fund or company name is required for Gold Investor verification.");
    }

    // Reject if a pending application already exists for this tier
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

    const row = {
      user_id: userId,
      tier: data.tier,
      // Keep link_primary populated for backward-compat with old admin panel
      link_primary: data.tier === "silver"
        ? (data.github_url ?? "")
        : (data.portfolio_url ?? data.fund_or_company_name ?? ""),
      link_secondary: data.tier === "silver"
        ? (data.live_project_url ?? null)
        : (data.linkedin_or_x_url ?? null),
      // New specific fields
      github_url: data.github_url || null,
      deployed_contract_address: data.deployed_contract_address || null,
      live_project_url: data.live_project_url || null,
      recent_ship_desc: data.recent_ship_desc || null,
      fund_or_company_name: data.fund_or_company_name || null,
      portfolio_url: data.portfolio_url || null,
      linkedin_or_x_url: data.linkedin_or_x_url || null,
      invite_code: data.invite_code || null,
    };

    const { error } = await supabase.from("verification_requests").insert(row);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

// ─── Admin: list pending applications ────────────────────────────────────────
export const listPendingApplications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // Admin gate
    const { data: adminCheck } = await supabase.rpc("has_role", {
      _role: "admin",
      _user_id: userId,
    });
    if (!adminCheck) throw new Error("Forbidden: Admin only.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("verification_requests")
      .select(`
        id, tier, status, created_at,
        github_url, deployed_contract_address, live_project_url, recent_ship_desc,
        fund_or_company_name, portfolio_url, linkedin_or_x_url, invite_code,
        link_primary, link_secondary,
        profiles!verification_requests_user_id_fkey(
          id, handle, display_name, avatar_url, company_name
        )
      `)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ─── Admin: approve or reject an application ─────────────────────────────────
export const reviewApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      applicationId: z.string().uuid(),
      action: z.enum(["approve", "reject"]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Admin gate
    const { data: adminCheck } = await supabase.rpc("has_role", {
      _role: "admin",
      _user_id: userId,
    });
    if (!adminCheck) throw new Error("Forbidden: Admin only.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Fetch the application
    const { data: app, error: fetchErr } = await supabaseAdmin
      .from("verification_requests")
      .select("id, tier, user_id, status")
      .eq("id", data.applicationId)
      .single();

    if (fetchErr || !app) throw new Error("Application not found.");
    if (app.status !== "pending") throw new Error("Application is no longer pending.");

    const newStatus = data.action === "approve" ? "approved" : "rejected";

    // Update application status
    const { error: updateErr } = await supabaseAdmin
      .from("verification_requests")
      .update({ status: newStatus, reviewed_at: new Date().toISOString() })
      .eq("id", data.applicationId);

    if (updateErr) throw new Error(updateErr.message);

    // If approved, upgrade the profile tier
    if (data.action === "approve") {
      await supabaseAdmin
        .from("profiles")
        .update({ verification_tier: app.tier })
        .eq("id", app.user_id);
    }

    // Fetch user's email via admin auth API
    const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.getUserById(app.user_id);
    const email = userData?.user?.email;

    if (email) {
      const tierLabel = app.tier === "silver" ? "Silver Builder" : "Gold Investor";
      if (data.action === "approve") {
        await sendEmail(
          email,
          "[The Ledger] Congratulations! Your Verification Has Been Approved",
          approvalEmailHtml(tierLabel),
        );
      } else {
        await sendEmail(
          email,
          "[The Ledger] Update on Your Verification Application",
          rejectionEmailHtml(),
        );
      }
    }

    return { ok: true, newStatus };
  });

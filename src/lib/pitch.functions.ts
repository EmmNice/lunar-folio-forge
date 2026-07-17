import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MAX_PITCH = 280;

/**
 * Submit a pitch to a Gold user.
 * Inserts the pitch row, then fires an email to the recipient via Resend
 * (requires RESEND_API_KEY env var; silently skips if not set).
 */
export const submitPitch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        recipientId: z.string().uuid(),
        companyName: z.string().min(1).max(80),
        pitch: z.string().min(1).max(MAX_PITCH),
        deckUrl: z.string().url().optional().or(z.literal("")),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // ── Weekly pitch-limit check ───────────────────────────────────────────
    const { data: recipient } = await supabase
      .from("profiles")
      .select("id, display_name, pitch_limit, verification_tier")
      .eq("id", data.recipientId)
      .maybeSingle();

    if (!recipient) throw new Error("Recipient not found.");
    if (recipient.verification_tier !== "gold") throw new Error("You can only pitch Gold members.");

    if (recipient.pitch_limit !== null) {
      if (recipient.pitch_limit === 0) {
        throw new Error("This member has paused inbound pitches. Please try again next week.");
      }
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabaseAdmin
        .from("pitches")
        .select("*", { count: "exact", head: true })
        .eq("recipient_id", data.recipientId)
        .gte("created_at", oneWeekAgo);
      if ((count ?? 0) >= recipient.pitch_limit) {
        throw new Error(
          "This member is at their connection limit for the week. Please try again next week.",
        );
      }
    }

    // ── Insert pitch ───────────────────────────────────────────────────────
    const { data: pitch, error } = await supabaseAdmin
      .from("pitches")
      .insert({
        sender_id: userId,
        recipient_id: data.recipientId,
        company_name: data.companyName,
        pitch: data.pitch,
        deck_url: data.deckUrl || null,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    // ── Fetch recipient's email for notification ───────────────────────────
    try {
      const resendKey = process.env.RESEND_API_KEY;
      if (!resendKey) {
        console.warn("[pitch] RESEND_API_KEY not set — skipping email notification.");
        return { pitchId: pitch.id };
      }

      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(data.recipientId);
      const recipientEmail = authUser?.user?.email;
      if (!recipientEmail) {
        console.warn("[pitch] Recipient has no email — skipping notification.");
        return { pitchId: pitch.id };
      }

      // Fetch sender display name
      const { data: sender } = await supabaseAdmin
        .from("profiles")
        .select("display_name, handle")
        .eq("id", userId)
        .maybeSingle();
      const senderName = sender?.display_name ?? "A founder";

      const dashboardUrl = `${process.env.VITE_APP_URL ?? "https://theledger.app"}/settings`;
      const deckSection = data.deckUrl
        ? `<p style="margin:0 0 8px"><strong>Deck / Demo:</strong> <a href="${data.deckUrl}" style="color:#f59e0b">${data.deckUrl}</a></p>`
        : "";

      const html = `
<!DOCTYPE html>
<html>
<body style="background:#0a0a0a;color:#f5f5f5;font-family:system-ui,sans-serif;padding:32px 24px;max-width:560px;margin:auto">
  <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#888">The Ledger</p>
  <h1 style="margin:0 0 24px;font-size:20px;font-weight:600">New Inbound Pitch</h1>

  <div style="border:1px solid #27272a;border-radius:12px;padding:20px;margin-bottom:24px">
    <p style="margin:0 0 4px;font-size:12px;color:#888">From</p>
    <p style="margin:0 0 16px;font-weight:600">${senderName}</p>

    <p style="margin:0 0 4px;font-size:12px;color:#888">Project / Company</p>
    <p style="margin:0 0 16px;font-weight:600">${data.companyName}</p>

    <p style="margin:0 0 4px;font-size:12px;color:#888">Pitch</p>
    <p style="margin:0 0 16px;line-height:1.6;white-space:pre-wrap">${data.pitch}</p>

    ${deckSection}
  </div>

  <a href="${dashboardUrl}"
     style="display:inline-block;background:#f59e0b;color:#000;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none">
    Review in Inbound Pitches →
  </a>

  <p style="margin:24px 0 0;font-size:11px;color:#555">
    You received this because you're a Gold member on The Ledger. Manage your pitch settings in Studio Settings.
  </p>
</body>
</html>`;

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "The Ledger <noreply@theledger.app>",
          to: [recipientEmail],
          subject: `New pitch from ${senderName}: ${data.companyName}`,
          html,
        }),
      });
    } catch (emailErr) {
      // Email failure should never block pitch delivery
      console.error("[pitch] Email send failed:", emailErr);
    }

    return { pitchId: pitch.id };
  });

/**
 * Accept a pitch: update status to 'accepted' and find-or-create a DM conversation.
 */
export const acceptPitch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ pitchId: z.string().uuid(), senderId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Update pitch status
    const { error: updateErr } = await supabaseAdmin
      .from("pitches")
      .update({ status: "accepted" })
      .eq("id", data.pitchId)
      .eq("recipient_id", userId);
    if (updateErr) throw new Error(updateErr.message);

    // Find or create conversation
    const [a, b] = [userId, data.senderId].sort();
    const existing = await supabaseAdmin
      .from("conversations")
      .select("id")
      .eq("user_a", a)
      .eq("user_b", b)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) return { conversationId: existing.data.id };

    const insert = await supabaseAdmin
      .from("conversations")
      .insert({ user_a: a, user_b: b, initiated_by: userId })
      .select("id")
      .single();
    if (insert.error) throw new Error(insert.error.message);
    return { conversationId: insert.data.id };
  });

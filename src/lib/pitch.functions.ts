import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_PITCH_LENGTH, PITCH_WINDOW_DAYS } from "./limits";
import { wantsNotification } from "./notification-prefs";

function pitchEmailHtml(input: {
  senderName: string;
  companyName: string;
  pitch: string;
  deckUrl: string | null;
  dashboardUrl: string;
}) {
  const deckSection = input.deckUrl
    ? `<p style="margin:0 0 8px"><strong>Deck / Demo:</strong> <a href="${input.deckUrl}" style="color:#f59e0b">${input.deckUrl}</a></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<body style="background:#0a0a0a;color:#f5f5f5;font-family:system-ui,sans-serif;padding:32px 24px;max-width:560px;margin:auto">
  <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#888">The Ledger</p>
  <h1 style="margin:0 0 24px;font-size:20px;font-weight:600">New Inbound Pitch</h1>

  <div style="border:1px solid #27272a;border-radius:12px;padding:20px;margin-bottom:24px">
    <p style="margin:0 0 4px;font-size:12px;color:#888">From</p>
    <p style="margin:0 0 16px;font-weight:600">${input.senderName}</p>

    <p style="margin:0 0 4px;font-size:12px;color:#888">Project / Company</p>
    <p style="margin:0 0 16px;font-weight:600">${input.companyName}</p>

    <p style="margin:0 0 4px;font-size:12px;color:#888">Pitch</p>
    <p style="margin:0 0 16px;line-height:1.6;white-space:pre-wrap">${input.pitch}</p>

    ${deckSection}
  </div>

  <a href="${input.dashboardUrl}"
     style="display:inline-block;background:#f59e0b;color:#000;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none">
    Review in Inbound Pitches &rarr;
  </a>

  <p style="margin:24px 0 0;font-size:11px;color:#555">
    You received this because you're a Gold member on The Ledger.
    Manage pitch and notification settings in Account Settings.
  </p>
</body>
</html>`;
}

/**
 * Submit a pitch to a Gold member.
 *
 * The pitch row is the product of this call; the email is a courtesy. If email
 * is unconfigured, the recipient has opted out, or Resend fails, the pitch still
 * lands in their in-app inbox and `emailed` comes back false so the UI can say so
 * instead of implying a message was delivered.
 */
export const submitPitch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        recipientId: z.string().uuid(),
        companyName: z.string().min(1).max(80),
        pitch: z.string().min(1).max(MAX_PITCH_LENGTH),
        deckUrl: z.string().url().optional().or(z.literal("")),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: recipient } = await supabase
      .from("profiles")
      .select("id, display_name, pitch_limit, verification_tier, notification_prefs")
      .eq("id", data.recipientId)
      .maybeSingle();

    if (!recipient) throw new Error("Recipient not found.");
    if (recipient.verification_tier !== "gold") {
      throw new Error("You can only pitch Gold members.");
    }

    // pitch_limit: null means unlimited, 0 means do-not-disturb, N is a weekly cap.
    if (recipient.pitch_limit !== null) {
      if (recipient.pitch_limit === 0) {
        throw new Error("This member has paused inbound pitches. Please try again next week.");
      }
      const windowStart = new Date(
        Date.now() - PITCH_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      const { count } = await supabaseAdmin
        .from("pitches")
        .select("*", { count: "exact", head: true })
        .eq("recipient_id", data.recipientId)
        .gte("created_at", windowStart);
      if ((count ?? 0) >= recipient.pitch_limit) {
        throw new Error(
          "This member is at their connection limit for the week. Please try again next week.",
        );
      }
    }

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

    const emailed = await notifyRecipient({
      recipientId: data.recipientId,
      recipientPrefs: recipient.notification_prefs,
      senderId: userId,
      companyName: data.companyName,
      pitch: data.pitch,
      deckUrl: data.deckUrl || null,
    });

    return { pitchId: pitch.id, emailed };
  });

/** Emails the recipient about a new pitch. Returns whether it actually went out. */
async function notifyRecipient(input: {
  recipientId: string;
  recipientPrefs: unknown;
  senderId: string;
  companyName: string;
  pitch: string;
  deckUrl: string | null;
}): Promise<boolean> {
  if (!wantsNotification(input.recipientPrefs, "pitches")) return false;

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendEmail, escapeHtml, safeHttpUrl } = await import("./email.server");
    const { appLink } = await import("./app-config.server");

    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(input.recipientId);
    const recipientEmail = authUser?.user?.email;
    if (!recipientEmail) return false;

    const { data: sender } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", input.senderId)
      .maybeSingle();
    const senderName = sender?.display_name ?? "A founder";

    const result = await sendEmail(
      recipientEmail,
      `New pitch from ${senderName}: ${input.companyName}`,
      pitchEmailHtml({
        senderName: escapeHtml(senderName),
        companyName: escapeHtml(input.companyName),
        pitch: escapeHtml(input.pitch),
        deckUrl: safeHttpUrl(input.deckUrl),
        dashboardUrl: appLink("/settings"),
      }),
    );
    return result.delivered;
  } catch (error) {
    // The pitch is already stored; a notification failure must not undo it.
    console.error("[pitch] Notification failed:", error);
    return false;
  }
}

/** Accept a pitch and open (or reuse) a DM thread with the sender. */
export const acceptPitch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ pitchId: z.string().uuid(), senderId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Scoped to recipient_id so only the person pitched can accept it.
    const { data: accepted, error: updateErr } = await supabaseAdmin
      .from("pitches")
      .update({ status: "accepted" })
      .eq("id", data.pitchId)
      .eq("recipient_id", userId)
      .eq("sender_id", data.senderId)
      .select("id")
      .maybeSingle();

    if (updateErr) throw new Error(updateErr.message);
    if (!accepted) throw new Error("Pitch not found, or it is not yours to accept.");

    const [userA, userB] = [userId, data.senderId].sort();

    const existing = await supabaseAdmin
      .from("conversations")
      .select("id")
      .eq("user_a", userA)
      .eq("user_b", userB)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) return { conversationId: existing.data.id };

    const insert = await supabaseAdmin
      .from("conversations")
      .insert({ user_a: userA, user_b: userB, initiated_by: userId })
      .select("id")
      .single();
    if (insert.error) throw new Error(insert.error.message);

    return { conversationId: insert.data.id };
  });

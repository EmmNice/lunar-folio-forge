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
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // The sender's own eligibility was never checked here. `pitches` has an RLS
    // policy requiring the sender to be Silver or Gold, but the insert below uses
    // the service role, which bypasses RLS entirely — so the only thing standing
    // between an unverified account and every Gold member's inbox was a disabled
    // button in the browser. Checking it explicitly is what makes the rule real.
    //
    // Read with the admin client because notification_prefs and account_status
    // are no longer granted to `authenticated` (20260929000100).
    const { data: sender } = await supabaseAdmin
      .from("profiles")
      .select("verification_tier, account_status")
      .eq("id", userId)
      .maybeSingle();

    if (!sender) throw new Error("Your profile could not be loaded.");
    if (sender.account_status !== "active") {
      throw new Error("Your account cannot send pitches right now.");
    }
    if (sender.verification_tier !== "silver" && sender.verification_tier !== "gold") {
      throw new Error("Only verified members can send pitches. Apply for verification first.");
    }

    const { data: recipient } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, pitch_limit, verification_tier, notification_prefs")
      .eq("id", data.recipientId)
      .maybeSingle();

    if (!recipient) throw new Error("Recipient not found.");
    if (recipient.id === userId) throw new Error("You cannot pitch yourself.");
    if (recipient.verification_tier !== "gold") {
      throw new Error("You can only pitch Gold members.");
    }

    // pitch_limit: null means unlimited, 0 means do-not-disturb, N is a weekly cap.
    if (recipient.pitch_limit === 0) {
      throw new Error("This member has paused inbound pitches. Please try again next week.");
    }

    // claim_pitch_slot counts the window and inserts under one row lock, so two
    // senders arriving together can no longer both pass a cap with one slot left.
    // The generated RPC argument types are non-nullable because Supabase's type
    // generator does not model nullable function parameters, but `_deck_url` and
    // `_weekly_limit` are both genuinely nullable in SQL (no deck; unlimited
    // inbox). Narrowing the cast to this one call keeps that fiction contained.
    const { data: pitchId, error } = await supabaseAdmin.rpc("claim_pitch_slot", {
      _sender_id: userId,
      _recipient_id: data.recipientId,
      _company_name: data.companyName,
      _pitch: data.pitch,
      _deck_url: data.deckUrl || null,
      _weekly_limit: recipient.pitch_limit,
      _window_days: PITCH_WINDOW_DAYS,
    } as unknown as {
      _sender_id: string;
      _recipient_id: string;
      _company_name: string;
      _pitch: string;
      _deck_url: string;
      _weekly_limit: number;
      _window_days: number;
    });

    if (error) throw new Error(error.message);
    if (!pitchId) {
      throw new Error(
        "This member is at their connection limit for the week. Please try again next week.",
      );
    }

    // In-app notification, so a pitch shows in the bell even when email is off or
    // unconfigured. Previously a pitch produced nothing but an email — if Resend
    // was not set up, the recipient had no way to learn it had arrived short of
    // opening the inbox on a hunch.
    if (wantsNotification(recipient.notification_prefs, "pitches")) {
      const { error: notifyErr } = await supabaseAdmin.from("notifications").insert({
        user_id: data.recipientId,
        actor_id: userId,
        type: "pitch",
        metadata: { pitchId, companyName: data.companyName },
      });
      if (notifyErr) console.warn("[pitch] Notification insert failed:", notifyErr.message);
    }

    const emailed = await notifyRecipient({
      recipientId: data.recipientId,
      recipientPrefs: recipient.notification_prefs,
      senderId: userId,
      companyName: data.companyName,
      pitch: data.pitch,
      deckUrl: data.deckUrl || null,
    });

    return { pitchId, emailed };
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

    // Scoped to recipient_id so only the person pitched can accept it, and to
    // pending/accepted so a pitch that was already declined cannot be quietly
    // revived. Re-accepting an accepted pitch is a no-op that returns the
    // existing thread, which keeps the button idempotent on a double click.
    const { data: accepted, error: updateErr } = await supabaseAdmin
      .from("pitches")
      .update({ status: "accepted" })
      .eq("id", data.pitchId)
      .eq("recipient_id", userId)
      .eq("sender_id", data.senderId)
      .in("status", ["pending", "accepted"])
      .select("id")
      .maybeSingle();

    if (updateErr) throw new Error(updateErr.message);
    if (!accepted) throw new Error("Pitch not found, or it is not yours to accept.");

    // No conversation slot is claimed and dm_cloaking is not consulted here, both
    // deliberately: the daily cap and the cloak exist to stop *unsolicited* DMs,
    // and this is the recipient opening a thread they were asked for. Spending
    // one of their own three daily slots to reply to their own inbox would be
    // backwards.

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

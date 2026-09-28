import { mailFrom, resendApiKey } from "./app-config.server";

/**
 * Transactional email via the Resend REST API.
 *
 * Server-only — import lazily from inside a server function handler.
 */

/**
 * Why an email did not go out. Callers surface this to the user instead of
 * reporting success for a message that was never sent.
 */
export type EmailSkipReason =
  /** RESEND_API_KEY is unset — email is not configured on this deployment. */
  | "not_configured"
  /** The recipient account has no email address on file. */
  | "no_recipient"
  /** Resend accepted the request but returned an error, or the call threw. */
  | "send_failed";

export type EmailResult = { delivered: true } | { delivered: false; reason: EmailSkipReason };

export async function sendEmail(to: string, subject: string, html: string): Promise<EmailResult> {
  const apiKey = resendApiKey();
  if (!apiKey) return { delivered: false, reason: "not_configured" };
  if (!to) return { delivered: false, reason: "no_recipient" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: mailFrom(), to, subject, html }),
    });

    if (!res.ok) {
      console.error(`[email] Resend rejected "${subject}": ${res.status} ${await res.text()}`);
      return { delivered: false, reason: "send_failed" };
    }
    return { delivered: true };
  } catch (error) {
    console.error(`[email] Send failed for "${subject}":`, error);
    return { delivered: false, reason: "send_failed" };
  }
}

/**
 * Escapes a value for interpolation into an email template.
 *
 * Pitch emails embed attacker-controlled text (company name, pitch body, deck
 * URL) into HTML that lands in a Gold member's inbox. Without escaping, a pitch
 * body could inject markup or a spoofed link, so every interpolated value goes
 * through here.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escapes a URL for an href, dropping anything that isn't http(s) so a
 * `javascript:` or `data:` deck link can't ride along.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return escapeHtml(url.toString());
  } catch {
    return null;
  }
}

/** User-facing explanation for a failed delivery, for toasts and API responses. */
export function emailSkipMessage(reason: EmailSkipReason): string {
  switch (reason) {
    case "not_configured":
      return "Email delivery is not configured, so no email notification was sent.";
    case "no_recipient":
      return "The recipient has no email address on file, so no email notification was sent.";
    case "send_failed":
      return "The email notification could not be delivered.";
  }
}

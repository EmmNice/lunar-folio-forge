#!/usr/bin/env node
/**
 * Applies this project's Supabase Auth configuration, including the branded
 * transactional email templates.
 *
 * Supabase Auth settings live in the dashboard, not in this repo, which makes them
 * the easiest part of the stack to lose: nothing reviews them, nothing recreates
 * them on a new project, and a wrong value (a Site URL missing its scheme, a
 * redirect allow-list that omits /reset-password) breaks account recovery in a way
 * that no test in CI would notice. This script is the source of truth instead.
 *
 * Idempotent. Run it as often as you like; it prints what it changed.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_...            # Account → Access Tokens
 *   SUPABASE_PROJECT_REF=abcdefghijklmnop    # Project Settings → General
 *   APP_URL=https://your-deployment          # public origin, scheme included
 *
 *   node scripts/configure-supabase-auth.mjs            # show the diff, change nothing
 *   node scripts/configure-supabase-auth.mjs --apply    # apply it
 *
 * To turn on real email delivery, add these and re-run with --apply:
 *
 *   SMTP_HOST=smtp.resend.com
 *   SMTP_PORT=587
 *   SMTP_USER=resend
 *   SMTP_PASS=re_...                 # the provider API key or SMTP password
 *   SMTP_SENDER_EMAIL=noreply@yourdomain.com
 *   SMTP_SENDER_NAME=The Ledger
 *
 * With SMTP set the script also enables email confirmation and raises the email
 * rate limit, because both are only safe once delivery is real. Without it, it
 * leaves confirmation off and says so — a project on Supabase's shared sender is
 * capped at a couple of messages an hour, and turning confirmation on there means
 * new members never receive the link and cannot get in at all.
 */

const API = "https://api.supabase.com/v1";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
const APP_URL = process.env.APP_URL;
const APPLY = process.argv.includes("--apply");

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

if (!TOKEN) fail("SUPABASE_ACCESS_TOKEN is not set.");
if (!REF) fail("SUPABASE_PROJECT_REF is not set.");
if (!APP_URL) fail("APP_URL is not set.");

let origin;
try {
  const parsed = new URL(APP_URL);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    fail(`APP_URL must be https (got ${parsed.protocol}//). Emailed links use it verbatim.`);
  }
  origin = parsed.origin;
} catch {
  fail(`APP_URL is not a URL: ${APP_URL}. It needs the scheme, e.g. https://example.com`);
}

const SMTP = {
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  senderEmail: process.env.SMTP_SENDER_EMAIL,
  senderName: process.env.SMTP_SENDER_NAME || "The Ledger",
};
const smtpProvided = Boolean(SMTP.host && SMTP.user && SMTP.pass && SMTP.senderEmail);
if (SMTP.host && !smtpProvided) {
  fail("SMTP_HOST is set but SMTP_USER, SMTP_PASS or SMTP_SENDER_EMAIL is missing.");
}

/* ────────────────────────────────── email ──────────────────────────────────
 * One shell, so every message the platform sends looks like it came from the
 * same product. Inline styles and a table-free single column: Gmail strips
 * <style> blocks, and Outlook's flexbox support is not worth designing around.
 * Supabase substitutes {{ .ConfirmationURL }} and friends server-side.
 */

const BRAND = {
  bg: "#0B0B0C",
  surface: "#141418",
  border: "rgba(255,255,255,0.09)",
  text: "#F5F5F6",
  muted: "rgba(245,245,246,0.62)",
  faint: "rgba(245,245,246,0.38)",
  accent: "#FBBF24",
};

function shell({ preheader, heading, intro, ctaLabel, ctaUrl, body = "", footnote }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
<div style="display:none;font-size:1px;color:${BRAND.bg};max-height:0;overflow:hidden;">${preheader}</div>
<div style="background:${BRAND.bg};padding:40px 20px;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;">

    <div style="margin-bottom:32px;">
      <span style="display:inline-block;width:28px;height:28px;background:${BRAND.text};border-radius:7px;text-align:center;line-height:28px;font-size:13px;font-weight:800;color:${BRAND.bg};vertical-align:middle;">L</span>
      <span style="margin-left:9px;font-size:15px;font-weight:700;letter-spacing:-0.3px;color:${BRAND.text};vertical-align:middle;">The Ledger</span>
    </div>

    <div style="background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:16px;padding:32px;">
      <h1 style="margin:0 0 12px;font-size:21px;line-height:1.3;font-weight:700;letter-spacing:-0.4px;color:${BRAND.text};">${heading}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${BRAND.muted};">${intro}</p>
      ${body}
      <a href="${ctaUrl}" style="display:inline-block;background:${BRAND.text};color:${BRAND.bg};font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;padding:13px 24px;">${ctaLabel}</a>
      <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:${BRAND.faint};">
        If the button doesn't work, paste this into your browser:<br>
        <span style="color:${BRAND.muted};word-break:break-all;">${ctaUrl}</span>
      </p>
    </div>

    <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:${BRAND.faint};">${footnote}</p>
    <p style="margin:14px 0 0;font-size:11px;color:${BRAND.faint};">The Ledger · For founders who ship.</p>

  </div>
</div>
</body>
</html>`;
}

const CONFIRMATION_URL = "{{ .ConfirmationURL }}";

const templates = {
  mailer_subjects_confirmation: "Confirm your email · The Ledger",
  mailer_templates_confirmation_content: shell({
    preheader: "Confirm your email address to finish setting up your account.",
    heading: "Confirm your email",
    intro:
      "You're one click from joining The Ledger. Confirming proves the address is yours — it's also how you'll recover the account later.",
    ctaLabel: "Confirm email address",
    ctaUrl: CONFIRMATION_URL,
    footnote:
      "This link expires in one hour and can be used once. If you didn't create an account, you can ignore this email.",
  }),

  mailer_subjects_recovery: "Reset your password · The Ledger",
  mailer_templates_recovery_content: shell({
    preheader: "Use this link to set a new password.",
    heading: "Set a new password",
    intro:
      "Someone asked to reset the password for this account. If that was you, choose a new one now.",
    ctaLabel: "Set a new password",
    ctaUrl: CONFIRMATION_URL,
    footnote:
      "This link expires in one hour and can only be used once. Setting a new password signs out every other device. If you didn't request this, ignore this email — nothing has changed.",
  }),

  mailer_subjects_magic_link: "Your sign-in link · The Ledger",
  mailer_templates_magic_link_content: shell({
    preheader: "Your one-time sign-in link.",
    heading: "Sign in to The Ledger",
    intro: "Here's your one-time sign-in link. No password needed.",
    ctaLabel: "Sign in",
    ctaUrl: CONFIRMATION_URL,
    footnote:
      "This link expires in one hour and can be used once. If you didn't ask to sign in, ignore this email and consider changing your password.",
  }),

  mailer_subjects_email_change: "Confirm your new email · The Ledger",
  mailer_templates_email_change_content: shell({
    preheader: "Confirm the new address on your account.",
    heading: "Confirm your new email",
    intro:
      'Confirm that <strong style="color:#F5F5F6;">{{ .NewEmail }}</strong> is yours and we\'ll move your account over to it.',
    ctaLabel: "Confirm new address",
    ctaUrl: CONFIRMATION_URL,
    footnote:
      "This link expires in one hour. Until you confirm, your account keeps its current address. If you didn't request this change, ignore this email and change your password.",
  }),

  mailer_subjects_invite: "You're invited to The Ledger",
  mailer_templates_invite_content: shell({
    preheader: "An invitation to join The Ledger.",
    heading: "You're invited",
    intro:
      "You've been invited to The Ledger — a high-signal network for founders, builders and investors. Accept to claim your handle.",
    ctaLabel: "Accept invitation",
    ctaUrl: CONFIRMATION_URL,
    footnote: "If you weren't expecting this invitation, you can safely ignore it.",
  }),

  mailer_subjects_reauthentication: "Your verification code · The Ledger",
  mailer_templates_reauthentication_content: shell({
    preheader: "Your verification code.",
    heading: "Confirm it's you",
    intro: "Enter this code to confirm a sensitive change to your account.",
    body: `<div style="margin:0 0 24px;padding:16px;background:rgba(255,255,255,0.04);border:1px solid ${BRAND.border};border-radius:10px;text-align:center;">
        <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:26px;font-weight:700;letter-spacing:6px;color:${BRAND.accent};">{{ .Token }}</span>
      </div>`,
    ctaLabel: "Open The Ledger",
    ctaUrl: "{{ .SiteURL }}",
    footnote:
      "This code expires shortly and can be used once. If you didn't request it, ignore this email and change your password.",
  }),
};

/* ───────────────────────────────── settings ───────────────────────────────── */

const desired = {
  // Emailed links are built from site_url. Without the scheme they arrive broken.
  site_url: origin,

  // `/**` is what allows /reset-password and the OAuth callback. The explicit
  // entries are redundant under it but harmless, and they document intent.
  uri_allow_list: [
    origin,
    `${origin}/**`,
    `${origin}/feed`,
    `${origin}/onboarding`,
    `${origin}/reset-password`,
  ].join(","),

  // Keep in step with MIN_PASSWORD_LENGTH in src/lib/limits.ts. If the two drift,
  // the form accepts a password the auth server then rejects.
  password_min_length: 8,
  // Rejects the single most common class of weak password without demanding
  // symbols, which mostly drives people to "Password1!" and a sticky note.
  password_required_characters: "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",

  // One hour, matching the copy in the emails and on /reset-password.
  mailer_otp_exp: 3600,

  // A changed address has to be confirmed on both the old and new mailbox, so a
  // hijacked session cannot quietly move the account somewhere else.
  mailer_secure_email_change_enabled: true,
  mailer_allow_unverified_email_sign_ins: false,

  // Rotate refresh tokens and keep a short reuse window so a stolen token is
  // detectable rather than indefinitely valid.
  refresh_token_rotation_enabled: true,
  security_refresh_token_reuse_interval: 10,

  external_anonymous_users_enabled: false,
};

// The branded templates are deliberately NOT in `desired` by default.
//
// Supabase rejects the whole PATCH with
//   "Email template modification is not available for free tier projects using
//    the default email provider"
// so including them unconditionally means none of the settings above get applied
// either. They go in only once a custom SMTP provider is configured, which is the
// same moment they become deliverable anyway.
if (smtpProvided) {
  Object.assign(desired, templates, {
    smtp_host: SMTP.host,
    smtp_port: String(SMTP.port || 587),
    smtp_user: SMTP.user,
    smtp_pass: SMTP.pass,
    smtp_admin_email: SMTP.senderEmail,
    smtp_sender_name: SMTP.senderName,
    // Delivery is real, so ownership of the address can now be required.
    mailer_autoconfirm: false,
    // Supabase's shared sender is capped at 2/hour; a real provider is not.
    rate_limit_email_sent: 100,
    smtp_max_frequency: 60,
  });
}

/* ────────────────────────────────── apply ────────────────────────────────── */

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) fail(`${method} ${path} → ${res.status}\n    ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

function summarise(value) {
  if (typeof value !== "string") return JSON.stringify(value);
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > 72 ? `${collapsed.slice(0, 69)}…` : collapsed;
}

const current = await api("GET", `/projects/${REF}/config/auth`);

const changes = [];
for (const [key, value] of Object.entries(desired)) {
  // smtp_pass is never returned by the API, so it can't be compared; always send it.
  if (key === "smtp_pass") continue;
  if (current[key] !== value) changes.push([key, current[key], value]);
}

console.log(`\n  Supabase Auth · project ${REF}`);
console.log(`  origin ${origin}`);
console.log(
  `  email  ${smtpProvided ? `custom SMTP via ${SMTP.host}` : "Supabase shared sender (development only)"}\n`,
);

if (changes.length === 0) {
  console.log("  Already matches this file. Nothing to do.\n");
} else {
  for (const [key, from, to] of changes) {
    console.log(`  ${key}`);
    console.log(`    − ${summarise(from)}`);
    console.log(`    + ${summarise(to)}`);
  }
  console.log("");
  if (!APPLY) {
    console.log(`  ${changes.length} change(s) pending. Re-run with --apply to write them.\n`);
    process.exit(0);
  }
  await api("PATCH", `/projects/${REF}/config/auth`, desired);
  console.log(`  ✓ Applied ${changes.length} change(s).\n`);
}

if (!smtpProvided) {
  console.log("  ⚠ No SMTP provider configured. Three consequences:");
  console.log("");
  console.log("    1. Email confirmation stays OFF. Supabase's shared sender is capped at");
  console.log("       roughly two messages an hour, so requiring confirmation would lock");
  console.log("       new members out entirely. Anyone can register an address they do");
  console.log("       not own until this is fixed.");
  console.log("    2. Password reset works, but is throttled to that same ceiling.");
  console.log("    3. The branded email templates in this file are NOT applied. Supabase");
  console.log("       refuses template changes on the free tier while the default sender");
  console.log("       is in use, so members receive Supabase's stock emails.");
  console.log("");
  console.log("    All three clear in one step. Set:");
  console.log("      SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_SENDER_EMAIL");
  console.log("    then re-run with --apply. This script will enable confirmation, raise");
  console.log("    the rate limit and install the templates in the same pass.\n");
} else {
  console.log("  ✓ Custom SMTP configured: confirmation required, branded templates live.\n");
}

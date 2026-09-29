/**
 * Product limits shared between the browser and server functions.
 *
 * Client-side checks here are for UX only — every one of these is re-enforced
 * server-side (or by a CHECK constraint) because the client can lie.
 */

/** Status card / post body cap. Matches the posts.content CHECK constraint. */
export const MAX_POST_LENGTH = 280;

/** Pitch body cap. Matches MAX_POST_LENGTH so a pitch fits on a card. */
export const MAX_PITCH_LENGTH = 280;

/** Direct message body cap. Matches the messages.body CHECK constraint. */
export const MAX_MESSAGE_LENGTH = 1000;

/** Short "what did you ship" blurb on the Silver verification form. */
export const MAX_SHIP_DESC_LENGTH = 100;

/**
 * Minimum password length. Matches the Supabase Auth `password_min_length`
 * setting on the project — the two drifting apart means the form accepts a
 * password the auth server then rejects.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** PulseAssist requests per rolling 24h for members without unlimited access. */
export const DAILY_AI_CREDITS = 3;

/** New conversations a member may start per UTC day. */
export const DAILY_CONVERSATION_LIMIT = 3;

/** Rolling window the pitch_limit quota is measured over. */
export const PITCH_WINDOW_DAYS = 7;

/** Largest avatar we accept before Supabase storage would reject it anyway. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * Posts pulled per feed page.
 *
 * Was 200 with no pagination, which meant two things: the newest 200 posts were
 * the entire reachable platform, and painting one screen cost 5 count queries
 * per card. The feed now pages with a created_at cursor and batches counts.
 */
export const FEED_PAGE_SIZE = 30;

/** Rows pulled for the notification bell and the pitch inbox. */
export const NOTIFICATION_PAGE_SIZE = 50;
export const PITCH_INBOX_PAGE_SIZE = 50;

/** Rows pulled for the admin moderation queue and audit trail. */
export const REPORT_QUEUE_PAGE_SIZE = 100;
export const AUDIT_LOG_PAGE_SIZE = 100;

/** Why a post was reported. Matches the reports.reason CHECK constraint. */
export const MAX_REPORT_REASON_LENGTH = 500;

/** Weekly inbound-pitch quotas a Gold member can choose from. */
export const PITCH_LIMIT_OPTIONS: { label: string; value: number | null }[] = [
  { label: "Do Not Disturb (block all)", value: 0 },
  { label: "3 per week (minimum)", value: 3 },
  { label: "5 per week", value: 5 },
  { label: "10 per week", value: 10 },
  { label: "20 per week", value: 20 },
  { label: "Unlimited", value: null },
];

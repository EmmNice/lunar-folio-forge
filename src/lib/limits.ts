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

/** PulseAssist requests per rolling 24h for members without unlimited access. */
export const DAILY_AI_CREDITS = 3;

/** New conversations a member may start per UTC day. */
export const DAILY_CONVERSATION_LIMIT = 3;

/** Rolling window the pitch_limit quota is measured over. */
export const PITCH_WINDOW_DAYS = 7;

/** Largest avatar we accept before Supabase storage would reject it anyway. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** Posts pulled per feed fetch. */
export const FEED_PAGE_SIZE = 200;

/** Rows pulled for the notification bell and the pitch inbox. */
export const NOTIFICATION_PAGE_SIZE = 50;
export const PITCH_INBOX_PAGE_SIZE = 50;

/** Weekly inbound-pitch quotas a Gold member can choose from. */
export const PITCH_LIMIT_OPTIONS: { label: string; value: number | null }[] = [
  { label: "Do Not Disturb (block all)", value: 0 },
  { label: "3 per week (minimum)", value: 3 },
  { label: "5 per week", value: 5 },
  { label: "10 per week", value: 10 },
  { label: "20 per week", value: 20 },
  { label: "Unlimited", value: null },
];

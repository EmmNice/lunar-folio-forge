/**
 * Notification preferences, stored on profiles.notification_prefs.
 *
 * These used to be localStorage keys, so they were per-browser and — more to the
 * point — the server functions that send the email had no way to read them.
 * The pitch and verification senders now check them before calling Resend.
 */

export type NotificationChannel = "messages" | "pitches" | "system";

export type NotificationPrefs = Record<NotificationChannel, boolean>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  messages: true,
  pitches: true,
  system: true,
};

/** Channel metadata, so both settings screens render from one list. */
export const NOTIFICATION_CHANNELS: {
  key: NotificationChannel;
  label: string;
  description: string;
}[] = [
  {
    key: "messages",
    label: "New Message Alerts",
    description: "Notify when someone sends you a direct message.",
  },
  {
    key: "pitches",
    label: "Pitch Match Alerts",
    description: "Notify when a new pitch arrives in your inbox.",
  },
  {
    key: "system",
    label: "System Updates",
    description: "Platform announcements, and verification decisions.",
  },
];

/**
 * Coerces whatever came back from the jsonb column into a complete prefs object.
 * A missing or malformed key falls back to opted-in, matching the column default.
 */
export function parseNotificationPrefs(value: unknown): NotificationPrefs {
  if (!value || typeof value !== "object") return { ...DEFAULT_NOTIFICATION_PREFS };

  const raw = value as Record<string, unknown>;
  return {
    messages: typeof raw.messages === "boolean" ? raw.messages : true,
    pitches: typeof raw.pitches === "boolean" ? raw.pitches : true,
    system: typeof raw.system === "boolean" ? raw.system : true,
  };
}

/** True when the member still wants email on this channel. */
export function wantsNotification(value: unknown, channel: NotificationChannel): boolean {
  return parseNotificationPrefs(value)[channel];
}

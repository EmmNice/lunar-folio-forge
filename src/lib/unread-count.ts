import { supabase } from "@/integrations/supabase/client";

/**
 * One shared realtime subscription for the unread counts, split by where they belong.
 *
 * Both the desktop header and the mobile tab bar need these numbers, and they are
 * mounted at the same time on every authenticated page. Calling
 * `supabase.channel(name)` twice with the same name does not create a second
 * channel — it hands back the existing one. So the second caller's `.on()` lands
 * on a channel that has already been subscribed, and supabase-js throws:
 *
 *   cannot add `postgres_changes` callbacks for realtime:notif-count:<uid>
 *   after `subscribe()`
 *
 * That throw happened inside an effect, so React escalated it to the error
 * boundary and the whole page became "Something went wrong" — intermittently,
 * depending on which component's effect ran first.
 *
 * Giving each consumer its own channel name would silence the error but open a
 * second websocket subscription for identical data. Reference counting one
 * subscription is both correct and cheaper.
 *
 * ---
 *
 * Why two numbers rather than one.
 *
 * A direct message used to land in the Alerts bell beside likes, re-ships and
 * verification decisions, and the Inbox tab — where anyone would actually look for
 * a message — carried no indicator at all. Messages are the one kind of
 * notification that has its own destination, so they get their own count and
 * badge that destination instead.
 *
 * The `notifications` table stays the store for both. It already has the `read`
 * flag that makes an unread count possible, and messages themselves have no read
 * state of their own — so this splits how the existing rows are *presented*
 * without inventing a second bookkeeping mechanism to keep in step.
 */

export type UnreadCounts = {
  /** Likes, replies, re-ships, mentions, pitches, verification decisions. */
  alerts: number;
  /** Direct messages. Badges the Inbox tab. */
  messages: number;
};

type Listener = (counts: UnreadCounts) => void;

const ZERO: UnreadCounts = { alerts: 0, messages: 0 };

let currentUserId: string | null = null;
let channel: ReturnType<typeof supabase.channel> | null = null;
let listeners = new Set<Listener>();
let latest: UnreadCounts = ZERO;

function emit(value: UnreadCounts) {
  latest = value;
  for (const listener of listeners) listener(value);
}

/**
 * Two counts in one round trip.
 *
 * `type` is selected rather than counted twice server-side: a member's unread
 * notifications are a small set, and one request that returns them beats two
 * head-count requests that each pay the same latency.
 */
async function refetch(userId: string) {
  const { data, error } = await supabase
    .from("notifications")
    .select("type")
    .eq("user_id", userId)
    .eq("read", false);
  if (error) return;

  let messages = 0;
  let alerts = 0;
  for (const row of data ?? []) {
    if (row.type === "message") messages += 1;
    else alerts += 1;
  }
  emit({ alerts, messages });
}

function teardown() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  currentUserId = null;
  latest = ZERO;
}

/**
 * Starts (or joins) the shared subscription for `userId`.
 * Returns an unsubscribe function; the channel closes when the last one detaches.
 */
export function subscribeToUnreadCount(userId: string, listener: Listener): () => void {
  // A different account signed in: drop the old channel before opening a new one.
  if (currentUserId && currentUserId !== userId) {
    teardown();
    listeners = new Set();
  }

  listeners.add(listener);
  listener(latest);

  if (!channel) {
    currentUserId = userId;
    channel = supabase
      .channel(`notif-count:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        // Refetched rather than incremented: the payload's type decides which of
        // the two counts moves, and getting that wrong shows a message as an alert.
        () => void refetch(userId),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => void refetch(userId),
      )
      .subscribe();
  }

  void refetch(userId);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) teardown();
  };
}

/** Lets a screen nudge a count after it marks things read, without a round trip. */
export function setUnreadCount(next: Partial<UnreadCounts>) {
  emit({
    alerts: Math.max(0, next.alerts ?? latest.alerts),
    messages: Math.max(0, next.messages ?? latest.messages),
  });
}

/** Drops the channel, the cached counts and every listener. */
export function resetUnreadCount() {
  teardown();
  listeners = new Set();
}

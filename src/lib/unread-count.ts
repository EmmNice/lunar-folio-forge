import { supabase } from "@/integrations/supabase/client";

/**
 * One shared realtime subscription for the unread notification count.
 *
 * Both the desktop header and the mobile tab bar need this number, and they are
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
 */

type Listener = (count: number) => void;

let currentUserId: string | null = null;
let channel: ReturnType<typeof supabase.channel> | null = null;
let listeners = new Set<Listener>();
let latest = 0;

function emit(value: number) {
  latest = value;
  for (const listener of listeners) listener(value);
}

async function refetch(userId: string) {
  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("read", false);
  if (error) return;
  emit(count ?? 0);
}

function teardown() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  currentUserId = null;
  latest = 0;
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
        () => emit(latest + 1),
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

/** Lets a screen nudge the count after it marks things read, without a round trip. */
export function setUnreadCount(value: number) {
  emit(Math.max(0, value));
}

/**
 * Drops the channel, the cached count and every listener.
 *
 * Needed because all of the above is module state, which outlives any component.
 * Teardown previously happened only when the last listener detached — i.e. as a
 * side effect of the header unmounting — so a sign-out that did not unmount the
 * header (the global SIGNED_OUT handler in __root.tsx, for instance) left the
 * previous account's notification channel subscribed and its count in memory for
 * the next person to sign in on this tab.
 *
 * Listeners are cleared too, not just notified: they belong to components from the
 * previous session, and their own effect cleanup will run momentarily anyway.
 */
export function resetUnreadCount() {
  for (const listener of listeners) listener(0);
  listeners = new Set();
  teardown();
}

/**
 * Clears everything about the previous account from this browser tab.
 *
 * Supabase's own `signOut()` removes its session from localStorage, and the two
 * sign-out handlers clear the React Query cache. Neither touches the two places
 * this app keeps per-account state of its own:
 *
 *   1. `sessionStorage` — the `_authenticated` route caches each user's onboarding
 *      status under `ob:<uuid>`. Nothing ever removed it except the onboarding
 *      screen itself, so after signing out the previous member's UUID and
 *      onboarding state sat in the tab for as long as it stayed open. Keyed by
 *      user id, so it could not be *misread* as the next member's — but it is the
 *      previous member's data surviving their session, and it leaks their id.
 *
 *   2. `lib/unread-count.ts` — module-level `latest`, `listeners` and a live
 *      realtime channel. Reset only as a side effect of the header unmounting,
 *      which is not something to rely on: the global SIGNED_OUT handler in
 *      __root.tsx never unmounts anything, so a sign-out routed through it left
 *      the previous account's notification channel subscribed and its count in
 *      memory.
 *
 * Called on sign-out and whenever the signed-in user id changes, so switching
 * accounts in one tab is equivalent to opening a fresh one.
 */

import { resetUnreadCount } from "./unread-count";

/** Prefix used by the _authenticated route's onboarding cache. */
const OB_PREFIX = "ob:";

export function resetPerUserState() {
  resetUnreadCount();

  if (typeof sessionStorage === "undefined") return;
  try {
    // Collect first: removing while iterating sessionStorage by index skips keys.
    const stale: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(OB_PREFIX)) stale.push(key);
    }
    for (const key of stale) sessionStorage.removeItem(key);
  } catch {
    // Private-mode Safari can throw on sessionStorage access. Losing a cache
    // entry is not worth breaking sign-out over.
  }
}

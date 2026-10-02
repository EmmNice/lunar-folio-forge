/**
 * The post edit window, as the client sees it.
 *
 * The rule itself lives in the database: touch_post_edited() refuses a
 * substantive edit once `created_at` is older than public.post_edit_window()
 * (20260930001000). This copy only decides whether to *offer* Edit. If the two
 * ever disagree the database wins and the member gets a clear message, so a
 * drifted constant here can cost a confusing button, never a bypass.
 */
export const POST_EDIT_WINDOW_MS = 10 * 60 * 1000;

/** Milliseconds of edit time left for a post, or 0 if the window has closed. */
export function editTimeLeft(createdAt: string, now: number = Date.now()): number {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, created + POST_EDIT_WINDOW_MS - now);
}

/** "7 min left", "under a minute left". */
export function describeEditTimeLeft(ms: number): string {
  if (ms < 60_000) return "under a minute left";
  return `${Math.ceil(ms / 60_000)} min left`;
}

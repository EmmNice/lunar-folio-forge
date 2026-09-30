import { supabase } from "@/integrations/supabase/client";
import type { PostStats } from "@/components/PostCard";

/**
 * The columns every post card needs, in one place.
 *
 * Lifted out of the feed route when the permalink page (`/p/$id`) needed the same
 * shape. Two copies of this string would drift, and a card rendered from the
 * second copy would quietly lose whichever column the other one gained.
 */
export const POST_SELECT =
  "id, content, background, comments_enabled, visibility, created_at, edited_at, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, verification_tier)";

/**
 * Like / re-ship / comment counts, and the viewer's own like, re-ship and
 * bookmark state, for a batch of posts.
 *
 * There are no denormalised counter columns, so the rows are still counted
 * client-side; the win is doing it in four requests rather than 5N.
 */
export async function fetchPostStats(
  ids: string[],
  uid: string | undefined,
): Promise<Map<string, PostStats>> {
  const blank = (): PostStats => ({
    likes: 0,
    reposts: 0,
    comments: 0,
    likedByMe: false,
    repostedByMe: false,
    bookmarkedByMe: false,
  });
  const map = new Map<string, PostStats>(ids.map((id) => [id, blank()]));
  if (ids.length === 0) return map;

  const [likes, reposts, comments, bookmarks] = await Promise.all([
    supabase.from("likes").select("post_id, user_id").in("post_id", ids),
    supabase.from("reposts").select("post_id, user_id").in("post_id", ids),
    supabase.from("comments").select("post_id").in("post_id", ids),
    // Own rows only, by policy, so this needs no user filter of its own — but one
    // is passed anyway so the query is covered by the (user_id, created_at) index.
    uid
      ? supabase.from("bookmarks").select("post_id").eq("user_id", uid).in("post_id", ids)
      : Promise.resolve({ data: [] as { post_id: string }[] }),
  ]);

  for (const row of likes.data ?? []) {
    const entry = map.get(row.post_id);
    if (!entry) continue;
    entry.likes += 1;
    if (uid && row.user_id === uid) entry.likedByMe = true;
  }
  for (const row of reposts.data ?? []) {
    const entry = map.get(row.post_id);
    if (!entry) continue;
    entry.reposts += 1;
    if (uid && row.user_id === uid) entry.repostedByMe = true;
  }
  for (const row of comments.data ?? []) {
    const entry = map.get(row.post_id);
    if (entry) entry.comments += 1;
  }
  for (const row of (bookmarks as { data: { post_id: string }[] | null }).data ?? []) {
    const entry = map.get(row.post_id);
    if (entry) entry.bookmarkedByMe = true;
  }

  return map;
}

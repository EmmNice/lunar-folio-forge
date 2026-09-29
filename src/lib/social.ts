/**
 * Follow, mute and relationship queries, run from the browser.
 *
 * All of these are ordinary writes and reads against RLS-protected tables. The
 * policies on `follows`, `mutes` and `blocks` restrict every statement to the
 * caller's own rows, and the follows INSERT policy additionally refuses a follow
 * across a block and from a suspended account — so there is nothing a server
 * function would add here beyond a round trip. Blocking is the one exception and
 * lives in social.functions.ts.
 *
 * Block and mute are enforced in deliberately different layers, which is worth
 * knowing before changing either:
 *
 *   A block is a symmetric boundary and lives in RLS — it is folded into
 *   can_view_post(), so the feed, profiles, search and realtime all inherit it
 *   without each remembering to filter.
 *
 *   A mute is one-directional and cosmetic: it only quiets the feed. It is
 *   applied in the feed query alone, not in RLS, because a mute that also hid
 *   the person's profile would be a block wearing a friendlier label.
 */

import { supabase } from "@/integrations/supabase/client";

export type Relationship = {
  following: boolean;
  blocked: boolean;
  muted: boolean;
};

export type FollowCounts = {
  followers: number;
  following: number;
};

/** Normalises a Supabase error into a message, or null on success. */
function errorMessage(error: { message: string } | null): string | null {
  return error ? error.message : null;
}

export async function followMember(viewerId: string, targetId: string): Promise<string | null> {
  const { error } = await supabase
    .from("follows")
    .insert({ follower_id: viewerId, following_id: targetId });
  return errorMessage(error);
}

export async function unfollowMember(viewerId: string, targetId: string): Promise<string | null> {
  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", viewerId)
    .eq("following_id", targetId);
  return errorMessage(error);
}

export async function muteMember(viewerId: string, targetId: string): Promise<string | null> {
  const { error } = await supabase.from("mutes").insert({ muter_id: viewerId, muted_id: targetId });
  return errorMessage(error);
}

export async function unmuteMember(viewerId: string, targetId: string): Promise<string | null> {
  const { error } = await supabase
    .from("mutes")
    .delete()
    .eq("muter_id", viewerId)
    .eq("muted_id", targetId);
  return errorMessage(error);
}

/**
 * Follower and following totals for one profile.
 *
 * Counted with `head: true` so no rows travel — there are no denormalised
 * counter columns, and adding them would mean maintaining them on every follow.
 */
export async function fetchFollowCounts(profileId: string): Promise<FollowCounts> {
  const [followers, following] = await Promise.all([
    supabase
      .from("follows")
      .select("*", { count: "exact", head: true })
      .eq("following_id", profileId),
    supabase
      .from("follows")
      .select("*", { count: "exact", head: true })
      .eq("follower_id", profileId),
  ]);
  return { followers: followers.count ?? 0, following: following.count ?? 0 };
}

/**
 * How the viewer stands towards one profile.
 *
 * `blocked` means *the viewer has blocked them*, which is the only direction the
 * UI can act on. Whether they have blocked the viewer is deliberately not
 * exposed: the blocks SELECT policy is select-own, and telling someone they have
 * been blocked is information the blocker did not choose to share. The effect is
 * still felt — their posts simply are not there.
 */
export async function fetchRelationship(viewerId: string, targetId: string): Promise<Relationship> {
  const [following, blocked, muted] = await Promise.all([
    supabase
      .from("follows")
      .select("follower_id")
      .eq("follower_id", viewerId)
      .eq("following_id", targetId)
      .maybeSingle(),
    supabase
      .from("blocks")
      .select("blocker_id")
      .eq("blocker_id", viewerId)
      .eq("blocked_id", targetId)
      .maybeSingle(),
    supabase
      .from("mutes")
      .select("muter_id")
      .eq("muter_id", viewerId)
      .eq("muted_id", targetId)
      .maybeSingle(),
  ]);

  return {
    following: Boolean(following.data),
    blocked: Boolean(blocked.data),
    muted: Boolean(muted.data),
  };
}

/**
 * Ids the viewer follows, for the Following feed.
 *
 * Capped because these ids are sent back as an `in.(...)` filter in a URL, and an
 * unbounded list would eventually exceed what the server accepts. At the cap the
 * feed quietly covers the earliest-followed accounts, which is a far better
 * failure than a request that 414s and shows nothing.
 */
const FOLLOW_ID_CAP = 1000;

export async function fetchFollowingIds(viewerId: string): Promise<string[]> {
  const { data } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", viewerId)
    .order("created_at", { ascending: true })
    .limit(FOLLOW_ID_CAP);
  return (data ?? []).map((row) => row.following_id);
}

export async function fetchMutedIds(viewerId: string): Promise<string[]> {
  const { data } = await supabase
    .from("mutes")
    .select("muted_id")
    .eq("muter_id", viewerId)
    .limit(FOLLOW_ID_CAP);
  return (data ?? []).map((row) => row.muted_id);
}

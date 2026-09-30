import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Plus, Loader2, ShieldAlert, Rss, Sparkles, Users } from "lucide-react";
import { EmptyState, ErrorState, PostSkeleton } from "@/components/states";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader, MobileNav } from "@/components/AppHeader";
import { toBackground } from "@/components/StatusCard";
import {
  PostCard,
  type FeedPost,
  type PostStats,
  type RepostAttribution,
} from "@/components/PostCard";
import { ComposerModal } from "@/components/ComposerModal";
import { useAuth } from "@/hooks/use-auth";
import type { VerificationTier } from "@/hooks/use-auth";
import { useCardExport } from "@/hooks/use-card-export";
import { FEED_PAGE_SIZE } from "@/lib/limits";
import { fetchFollowingIds, fetchMutedIds } from "@/lib/social";
import { ACTION_INK, ACTION_SURFACE, tierVisual } from "@/lib/tier-style";

export const Route = createFileRoute("/feed")({
  head: () => ({
    meta: [
      { title: "Explore Feed — The Ledger" },
      {
        name: "description",
        content:
          "The global timeline of tech founders and builders — one chronological feed, no follower graph.",
      },
    ],
  }),
  component: FeedPage,
});

/**
 * Signal and Beat are two cuts of the same global timeline, split by who wrote
 * the post. Following is a different axis — a narrower audience, not a different
 * kind of author — and it is deliberately an *additional* lens rather than the
 * default.
 *
 * The Ledger's premise is one chronological feed where a first post is as visible
 * as a thousandth; making Following the landing tab would quietly turn it into a
 * follower-count game, which is the thing this platform exists not to be.
 */
type FeedTab = "signal" | "beat" | "following";

/** The two author-tier feeds. Following is paged separately. */
type TierTab = "signal" | "beat";

/**
 * Which authors each tab carries.
 *
 * This is the split the tabs were built for: Signal is the verified room, Beat is
 * where everyone else is heard. Silver sits in both on purpose — a verified
 * builder is still part of the day-to-day — and Gold appears only in Signal, so
 * the loudest accounts cannot crowd out an unverified author's first post.
 *
 * It is a filter on the *author's* tier, never the viewer's. An unverified or
 * signed-out reader sees both tabs in full; `can_view_post()` has no author-tier
 * rule and this must not become one.
 */
const TAB_AUTHOR_TIERS: Record<TierTab, VerificationTier[]> = {
  signal: ["silver", "gold"],
  beat: ["none", "silver"],
};

const POST_SELECT =
  "id, content, background, comments_enabled, visibility, created_at, edited_at, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, verification_tier)";

/**
 * Same columns, but the author embed is an inner join so PostgREST will accept a
 * filter on `author.verification_tier` and apply it in the database.
 *
 * The tier split used to be done in JS over a page of the global timeline. That
 * is fine for a split by post shape, which was what this code drifted into, but
 * wrong for a split by author: with verified accounts rare, twenty global rows
 * can easily contain none of them, and Signal would render empty next to a
 * "Load more" button that had to be pressed dozens of times to find anything.
 * Filtering server-side means one page of Signal is one page of Signal.
 */
const TIER_POST_SELECT = POST_SELECT.replace(
  "author:profiles!posts_author_id_fkey(",
  "author:profiles!posts_author_id_fkey!inner(",
);

/**
 * One tier tab's list, with the cursor it pages from.
 *
 * `posts === null` means "not loaded yet" and is what the skeleton renders on;
 * an empty array means the query came back with nothing, which is a real and
 * different state (a quiet Signal tab on a young platform).
 */
type TierFeedState = {
  posts: FeedPost[] | null;
  oldest: string | null;
  hasMore: boolean;
};

const EMPTY_TIER_FEED: TierFeedState = { posts: null, oldest: null, hasMore: false };

/**
 * A repost, with the post it points at and who re-shipped it.
 *
 * The embedded post comes back null when RLS hides it — a whisper post from
 * outside the audience, or an author who has since blocked the viewer — so the
 * null case is filtered rather than rendered as an empty card.
 */
const REPOST_SELECT = `created_at, user_id, reposter:profiles!reposts_user_id_fkey(handle, display_name), post:posts!reposts_post_id_fkey(${POST_SELECT})`;

/**
 * A row as it comes back from the feed query. background is free text in the DB,
 * and comments_enabled/visibility were added after launch, so older rows can
 * still be null.
 */
type RawFeedRow = Omit<FeedPost, "background" | "comments_enabled" | "visibility" | "author"> & {
  background: string | null;
  comments_enabled: boolean | null;
  visibility: string | null;
  author: Omit<FeedPost["author"], "verification_tier"> & { verification_tier: string };
};

/**
 * One entry in the Following timeline: either a post, or somebody's re-ship of one.
 *
 * `timelineAt` is what the list sorts on — the repost's timestamp for a re-ship,
 * the post's own for an original. Sorting reposts by the original's date would
 * bury a re-ship of an old post where nobody would ever see it, which defeats the
 * point of re-shipping.
 */
type TimelineItem = {
  key: string;
  post: FeedPost;
  repostedBy?: RepostAttribution;
  timelineAt: string;
};

// Main feed page
function FeedPage() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<FeedTab>("signal");
  /*
    One independently-paged list per tier tab.

    Both used to be carved out of a single shared page by post background, which
    silently replaced the author-tier split the tabs were named for (6b5085f,
    2026-07-20). They are two different queries now, so each needs its own cursor
    and its own end-of-list flag: Signal and Beat run out at different depths.
  */
  const [feeds, setFeeds] = useState<Record<TierTab, TierFeedState>>({
    signal: EMPTY_TIER_FEED,
    beat: EMPTY_TIER_FEED,
  });
  const [followingItems, setFollowingItems] = useState<TimelineItem[] | null>(null);
  const [followingIds, setFollowingIds] = useState<string[] | null>(null);
  /**
   * Muted accounts, applied to the feed only.
   *
   * A mute is cosmetic and one-directional, so it is not in RLS: their posts still
   * load, they are simply not shown here. A block is the one that removes them
   * from the viewer's world entirely, and that lives in can_view_post().
   */
  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());
  const [followingHasMore, setFollowingHasMore] = useState(false);
  const [showModal, setShowModal] = useState(false);

  /*
    Mirrors of the two lists above, for the realtime handler.

    That subscription is set up once per signed-in user and must not be torn down
    and re-established every time a mute or a follow changes — re-subscribing a
    channel by the same name is an error, not a no-op, and it cost us a crash
    once already. Refs let the handler read current values without becoming a
    dependency of the effect that owns the channel.
  */
  const mutedIdsRef = useRef(mutedIds);
  const followingIdsRef = useRef(followingIds);
  useEffect(() => {
    mutedIdsRef.current = mutedIds;
  }, [mutedIds]);
  useEffect(() => {
    followingIdsRef.current = followingIds;
  }, [followingIds]);
  const [fabVisible, setFabVisible] = useState(true);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [stats, setStats] = useState<Map<string, PostStats>>(new Map());
  const [feedError, setFeedError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const { requestExport, exportSurface } = useCardExport();

  // Redirect unonboarded users
  useEffect(() => {
    if (loading) return;
    if (user && profile && !profile.onboarding_completed) {
      navigate({ to: "/onboarding", replace: true });
    }
  }, [loading, user, profile, navigate]);

  // FAB visibility: hide while scrolling, reappear when scroll stops
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    function onScroll() {
      setFabVisible(false);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setFabVisible(true), 800);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Shared row normaliser
  function normalisePosts(data: RawFeedRow[]): FeedPost[] {
    return data.map((p) => ({
      ...p,
      background: toBackground(p.background),
      comments_enabled: p.comments_enabled ?? true,
      visibility: p.visibility ?? "public",
      author: {
        ...p.author,
        verification_tier: p.author.verification_tier as VerificationTier,
      },
    }));
  }

  /**
   * Drops posts by muted authors. Applied after the fetch — see `mutedIds`.
   *
   * Reads the ref, not the state. The effect that calls loadPage runs once on
   * mount and therefore captures the *first* render's copy of this function,
   * whose `mutedIds` is still empty. The mute list usually resolves before the
   * posts query returns, and in that order the re-filter effect below sees
   * `signalPosts === null` and does nothing — so the page painted a muted
   * author's posts and only hid them on the next fetch. The ref is always current.
   */
  function withoutMuted(posts: FeedPost[]): FeedPost[] {
    const muted = mutedIdsRef.current;
    if (muted.size === 0) return posts;
    return posts.filter((p) => !muted.has(p.author.id));
  }

  /**
   * Applies one transform to whichever tier lists are loaded.
   *
   * Edits, deletes and mutes are not tab-specific, and a silver author's post is
   * genuinely in both lists, so every one of these has to touch both or the same
   * post shows two different versions of itself depending on the tab.
   */
  function patchTierFeeds(fn: (posts: FeedPost[]) => FeedPost[]) {
    setFeeds((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next) as TierTab[]) {
        const current = next[key];
        if (current.posts) next[key] = { ...current, posts: fn(current.posts) };
      }
      return next;
    });
  }

  /**
   * Counts for a whole page of posts, in three queries instead of five per card.
   *
   * PostCard used to fetch its own like/repost/comment counts plus the viewer's
   * own like and repost — five round trips each. At the old FEED_PAGE_SIZE of 200
   * that was up to a thousand requests to paint one screen.
   *
   * There are no denormalised counter columns, so the rows are still counted
   * client-side; the win is doing it in three requests rather than 5N.
   */
  async function fetchStats(
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

  /**
   * Load one page of the timeline.
   *
   * `whisper` and `verified_only` filtering used to happen here in JS while the
   * RLS policy was `USING (true)` — so restricted posts were delivered to every
   * browser and readable straight from the REST API. The audience rule now lives
   * in the posts SELECT policy (20260929000200), which is why there is no filter
   * left in this function: what comes back is already what the viewer may see.
   */
  async function loadPage(which: TierTab, opts: { before?: string; append: boolean }) {
    let query = supabase
      .from("posts")
      .select(TIER_POST_SELECT)
      .in("author.verification_tier", TAB_AUTHOR_TIERS[which])
      .order("created_at", { ascending: false })
      .limit(FEED_PAGE_SIZE);
    if (opts.before) query = query.lt("created_at", opts.before);

    const { data, error } = await query;

    if (error) {
      setFeedError("Couldn't load the feed. Check your connection and try again.");
      if (!opts.append) {
        setFeeds((prev) => ({ ...prev, [which]: { posts: [], oldest: null, hasMore: false } }));
      }
      return;
    }

    setFeedError(null);
    // The double cast is the price of filtering on an embedded column: the
    // generated types do not model `author.verification_tier` as a filterable
    // key, so supabase-js widens the row type it hands back.
    const page = normalisePosts((data ?? []) as unknown as RawFeedRow[]);

    const pageStats = await fetchStats(
      page.map((p) => p.id),
      user?.id,
    );
    setStats((prev) => {
      /*
        Stats are keyed by post id and shared across tabs, so this merges rather
        than replaces even on a first page: clearing it would wipe the counts of
        the *other* tab, which is loaded in parallel and would lose its like and
        comment numbers the moment this query returned.
      */
      const next = new Map(prev);
      pageStats.forEach((value, key) => next.set(key, value));
      return next;
    });

    const visible = withoutMuted(page);

    setFeeds((prev) => {
      const current = prev[which];
      return {
        ...prev,
        [which]: {
          posts: opts.append ? [...(current.posts ?? []), ...visible] : visible,
          /*
            The cursor advances on the raw page, not the muted-filtered one. Using
            the last *visible* row would re-request everything a muted author wrote
            after it on the next press, and could stall paging entirely on a page
            where every row was muted.
          */
          oldest: page.length > 0 ? page[page.length - 1].created_at : current.oldest,
          hasMore: page.length === FEED_PAGE_SIZE,
        },
      };
    });
  }

  async function loadMore() {
    if (tab === "following") return;
    const current = feeds[tab];
    if (loadingMore || !current.hasMore || !current.oldest) return;
    setLoadingMore(true);
    await loadPage(tab, { before: current.oldest, append: true });
    setLoadingMore(false);
  }

  /**
   * One page of the Following timeline: posts by people you follow, interleaved
   * with their re-ships.
   *
   * Two queries rather than one. There is no single table holding "things that
   * should reach me", and expressing this as one PostgREST query would mean either
   * a view (which would need its own RLS reasoning) or an `or` across a join that
   * the planner handles poorly. Two indexed reads and a merge in JS is both simpler
   * to follow and honest about what it costs.
   *
   * Both halves are paged by the same `before` cursor, so the merged result is
   * continuous even though the two sources advance at different rates.
   */
  async function loadFollowingPage(ids: string[], opts: { before?: string; append: boolean }) {
    if (ids.length === 0) {
      setFollowingItems([]);
      setFollowingHasMore(false);
      return;
    }

    let postQuery = supabase
      .from("posts")
      .select(POST_SELECT)
      .in("author_id", ids)
      .order("created_at", { ascending: false })
      .limit(FEED_PAGE_SIZE);

    let repostQuery = supabase
      .from("reposts")
      .select(REPOST_SELECT)
      .in("user_id", ids)
      .order("created_at", { ascending: false })
      .limit(FEED_PAGE_SIZE);

    if (opts.before) {
      postQuery = postQuery.lt("created_at", opts.before);
      repostQuery = repostQuery.lt("created_at", opts.before);
    }

    const [postsRes, repostsRes] = await Promise.all([postQuery, repostQuery]);

    if (postsRes.error || repostsRes.error) {
      setFeedError("Couldn't load your Following feed. Check your connection and try again.");
      if (!opts.append) setFollowingItems([]);
      return;
    }

    setFeedError(null);

    const ownPosts: TimelineItem[] = withoutMuted(
      normalisePosts((postsRes.data ?? []) as unknown as RawFeedRow[]),
    ).map((post) => ({ key: `post:${post.id}`, post, timelineAt: post.created_at }));

    type RawRepostRow = {
      created_at: string;
      user_id: string;
      reposter: { handle: string; display_name: string } | null;
      post: RawFeedRow | null;
    };

    const reposts: TimelineItem[] = [];
    for (const row of (repostsRes.data ?? []) as unknown as RawRepostRow[]) {
      // RLS hid the post, or it was deleted between the two queries.
      if (!row.post || !row.reposter) continue;
      const [post] = normalisePosts([row.post]);
      if (!post) continue;
      // Ref, for the same stale-closure reason as withoutMuted above.
      if (mutedIdsRef.current.has(post.author.id)) continue;
      reposts.push({
        key: `repost:${row.user_id}:${post.id}`,
        post,
        repostedBy: row.reposter,
        timelineAt: row.created_at,
      });
    }

    /*
      Merge, newest first, and show each post once.

      A post can arrive twice — its author posted it and somebody else you follow
      re-shipped it. Keeping the first occurrence after sorting means the timeline
      shows it at the moment it most recently reached you, which is the entry the
      reader is expecting to find.
    */
    const merged = [...ownPosts, ...reposts].sort((a, b) =>
      a.timelineAt < b.timelineAt ? 1 : a.timelineAt > b.timelineAt ? -1 : 0,
    );

    const seen = new Set<string>();
    const deduped: TimelineItem[] = [];
    for (const item of merged) {
      if (seen.has(item.post.id)) continue;
      seen.add(item.post.id);
      deduped.push(item);
    }

    // More to fetch if either source filled its page.
    setFollowingHasMore(
      (postsRes.data?.length ?? 0) === FEED_PAGE_SIZE ||
        (repostsRes.data?.length ?? 0) === FEED_PAGE_SIZE,
    );

    const pageStats = await fetchStats(
      deduped.map((i) => i.post.id),
      user?.id,
    );
    setStats((prev) => {
      const next = new Map(opts.append ? prev : prev);
      pageStats.forEach((value, key) => next.set(key, value));
      return next;
    });

    setFollowingItems((prev) => {
      if (!opts.append) return deduped;
      const existing = new Set((prev ?? []).map((i) => i.post.id));
      return [...(prev ?? []), ...deduped.filter((i) => !existing.has(i.post.id))];
    });
  }

  async function loadMoreFollowing() {
    if (loadingMore || !followingHasMore || !followingItems || followingItems.length === 0) return;
    const oldest = followingItems[followingItems.length - 1].timelineAt;
    setLoadingMore(true);
    await loadFollowingPage(followingIds ?? [], { before: oldest, append: true });
    setLoadingMore(false);
  }

  /*
    Who the viewer follows and mutes.

    Loaded once per session rather than per page, because both lists are small and
    change rarely, and re-reading them on every "load older posts" would triple the
    request count for no benefit.
  */
  useEffect(() => {
    if (!user) {
      setMutedIds(new Set());
      setFollowingIds(null);
      setFollowingItems(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const [muted, follows] = await Promise.all([
        fetchMutedIds(user.id),
        fetchFollowingIds(user.id),
      ]);
      if (cancelled) return;
      setMutedIds(new Set(muted));
      setFollowingIds(follows);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  /*
    Re-filter anything already on screen once the mute list arrives.

    The first page is requested before this list is known — without this, a muted
    author's post would be visible until the next fetch, which is precisely the
    moment the reader notices.
  */
  useEffect(() => {
    if (mutedIds.size === 0) return;
    patchTierFeeds((posts) => posts.filter((p) => !mutedIds.has(p.author.id)));
    setFollowingItems((prev) =>
      prev ? prev.filter((i) => !mutedIds.has(i.post.author.id)) : prev,
    );
  }, [mutedIds]);

  /* First page of the Following tab, fetched when it is first opened. */
  useEffect(() => {
    if (tab !== "following" || !user) return;
    if (followingIds === null || followingItems !== null) return;
    loadFollowingPage(followingIds, { append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, user, followingIds, followingItems]);

  useEffect(() => {
    // Both tier tabs are loaded up front, in parallel, so switching between them
    // never waits on the network.
    loadPage("signal", { append: false });
    loadPage("beat", { append: false });

    // Realtime used to refetch the entire feed on every INSERT from anyone, so one
    // person posting made every open browser re-download the whole timeline.
    // Fetch just the new row and prepend it.
    const channel = supabase
      .channel("public:posts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        async (payload) => {
          const id = (payload.new as { id?: string }).id;
          if (!id) return;
          const { data } = await supabase
            .from("posts")
            .select(POST_SELECT)
            .eq("id", id)
            .maybeSingle();
          // RLS decides whether this viewer is in the audience; a whisper post
          // from someone else simply comes back empty here.
          if (!data) return;
          const [fresh] = normalisePosts([data as unknown as RawFeedRow]);
          if (!fresh) return;
          // A muted author's post still arrives over the wire — the mute is a
          // display rule, so it has to be applied here too.
          if (mutedIdsRef.current.has(fresh.author.id)) return;

          // Routed by the author's tier, the same rule the queries use. A silver
          // author lands in both tabs; gold only in Signal, unverified only in Beat.
          setFeeds((prev) => {
            const next = { ...prev };
            for (const key of Object.keys(next) as TierTab[]) {
              if (!TAB_AUTHOR_TIERS[key].includes(fresh.author.verification_tier)) continue;
              const current = next[key];
              // A tab that has not loaded yet is left alone: seeding it here would
              // turn its skeleton into a one-post feed with no cursor to page from.
              if (current.posts === null) continue;
              if (current.posts.some((p) => p.id === fresh.id)) continue;
              next[key] = { ...current, posts: [fresh, ...current.posts] };
            }
            return next;
          });

          // Same post, second home: the Following tab keeps its own list, so a
          // live post from someone the viewer follows has to be inserted there as
          // well or the tab silently goes stale while it is open.
          if (followingIdsRef.current?.includes(fresh.author.id)) {
            setFollowingItems((prev) => {
              if (prev === null) return prev;
              if (prev.some((i) => i.post.id === fresh.id)) return prev;
              return [
                { key: `post:${fresh.id}`, post: fresh, timelineAt: fresh.created_at },
                ...prev,
              ];
            });
          }
        },
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "posts" }, (payload) => {
        const id = (payload.old as { id?: string }).id;
        if (!id) return;
        patchTierFeeds((posts) => posts.filter((p) => p.id !== id));
        setFollowingItems((prev) => prev?.filter((i) => i.post.id !== id) ?? null);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /*
    Signal and Beat are both pre-loaded at mount, so switching between them is
    instant. Following is fetched on first open instead: it is a different query
    against a list the viewer may not even have, and paying for it on every feed
    visit would slow the common case down for the rarer one.
  */
  const displayedItems: TimelineItem[] =
    tab === "following"
      ? (followingItems ?? [])
      : (feeds[tab].posts ?? []).map((post) => ({
          key: `post:${post.id}`,
          post,
          timelineAt: post.created_at,
        }));

  const feedLoading = tab === "following" ? followingItems === null : feeds[tab].posts === null;

  /**
   * Whether a post by *this* viewer would appear in the given tab.
   *
   * Used by the empty states and the composer hint. Reading a tab is never
   * restricted; this is only about where your own writing shows up.
   */
  function viewerPostsLandIn(which: TierTab): boolean {
    if (!profile) return false;
    return TAB_AUTHOR_TIERS[which].includes(profile.verification_tier);
  }

  /**
   * Copy for an empty tier tab.
   *
   * Three cases, not two. Having no profile is not the same as having a profile
   * whose posts go elsewhere, and collapsing them told a signed-out visitor "your
   * gold posts go to Signal" — which was observed on the deployed site, and is
   * wrong twice over: they have no posts and no badge.
   */
  function emptyTabDescription(which: TierTab): string {
    if (!profile) {
      return which === "signal"
        ? "Signal carries posts from verified builders — silver and gold. Anyone can read it; nobody has posted yet."
        : "Beat is the open floor, where every builder without a gold badge posts. Nothing here yet.";
    }
    if (viewerPostsLandIn(which)) {
      return which === "signal"
        ? "Signal carries posts from verified builders. Be the first to ship something worth reading."
        : "Beat is the open floor — every builder without a gold badge posts here. Be the first.";
    }
    return which === "signal"
      ? "Signal carries posts from verified builders only — silver and gold. You can read every word of it; earning a badge is what puts your own posts here."
      : "Beat is where unverified and silver builders post. Your gold posts go to Signal instead.";
  }

  // Following is meaningless without an account to follow from.
  const visibleTabs: FeedTab[] = user ? ["signal", "beat", "following"] : ["signal", "beat"];

  const TAB_META: Record<FeedTab, { label: string; icon: typeof Rss; blurb: string }> = {
    signal: {
      label: "Signal",
      icon: Rss,
      blurb: "Verified builders only — silver and gold, vouched for and on the record.",
    },
    beat: {
      label: "Beat",
      icon: Sparkles,
      blurb: "Where everyone else is shipping. Open to all, gold kept out so it stays that way.",
    },
    following: {
      label: "Following",
      icon: Users,
      blurb: "Only the builders you follow, plus what they re-ship.",
    },
  };

  /** Replaces one post in whichever list holds it, after an in-place edit. */
  function applyEdit(id: string, content: string, editedAt: string | null) {
    const patch = (p: FeedPost) => (p.id === id ? { ...p, content, edited_at: editedAt } : p);
    patchTierFeeds((posts) => posts.map(patch));
    setFollowingItems(
      (prev) => prev?.map((i) => (i.post.id === id ? { ...i, post: patch(i.post) } : i)) ?? null,
    );
  }

  function removePostFromLists(id: string) {
    patchTierFeeds((posts) => posts.filter((x) => x.id !== id));
    setFollowingItems((prev) => prev?.filter((i) => i.post.id !== id) ?? null);
  }

  return (
    <div className="min-h-screen">
      {/*
         Combined sticky header: top nav + Signal/Beat tabs as ONE unit
        NOTE: MobileNav is rendered as a sibling BELOW this div, not inside it.
        A position:fixed element inside a CSS-transformed ancestor gets positioned
        relative to that ancestor instead of the viewport. Keeping MobileNav out
        of this div ensures it stays pinned to the bottom of the screen.
      */}
      <div
        className="sticky top-0 z-40"
        style={{
          background: "rgba(11,11,12,0.92)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          /* Hide fast (150 ms ease-out), reveal instantly (80 ms) — mirrors X's tab bar */
          transition: headerHidden ? "transform 0.15s ease-out" : "transform 0.08s ease-out",
          transform: headerHidden ? "translateY(-100%)" : "translateY(0)",
          willChange: "transform",
        }}
      >
        {/* Top nav bar — controlled mode: no internal scroll listener, no sticky/transform of its own */}
        <AppHeader controlled />

        {/* Signal / Beat tab switcher */}
        <div className="mx-auto max-w-xl px-4 pb-3 pt-1 sm:px-6">
          <div>
            <div className="segmented sm:max-w-[24rem]">
              {visibleTabs.map((t) => {
                const Icon = TAB_META[t].icon;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    data-active={tab === t}
                    className="segmented-item"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {TAB_META[t].label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile bottom nav — outside the transformed header so position:fixed works correctly */}
      <MobileNav />

      {/* max-w-xl, not 2xl: at 672px a post ran nearly the full width of a desktop
          window, which reads as a slab rather than a feed. */}
      <main className="page-enter mx-auto max-w-xl px-4 pb-mobile-nav pt-5 sm:px-6">
        {/*
          Moderation state, said out loud. RLS blocks posting, commenting, liking,
          re-shipping and messaging for a restricted or banned account, so without
          this banner every one of those buttons would just fail with no
          explanation of why.
        */}
        {profile && profile.account_status !== "active" && (
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-4">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="text-xs leading-relaxed">
              <p className="font-semibold text-amber-300">
                {profile.account_status === "banned"
                  ? "Your account has been suspended"
                  : "Your account is read-only"}
              </p>
              <p className="mt-1 text-muted-foreground">
                {profile.account_status === "banned"
                  ? "You can still read The Ledger, but your posts are hidden and you cannot publish, reply or message. Contact support if you believe this is a mistake."
                  : "You can read and browse, but posting, replying, liking and messaging are paused. Contact support if you believe this is a mistake."}
              </p>
            </div>
          </div>
        )}

        {/* Feed load failures used to be a toast that vanished, leaving an empty page */}
        {feedError && (
          <div className="mb-5">
            <ErrorState
              message={feedError}
              onRetry={() => {
                // Retries whichever feed the reader is actually looking at. Following
                // pages from its own query and its own cursor.
                if (tab === "following") {
                  if (followingIds) loadFollowingPage(followingIds, { append: false });
                  return;
                }
                loadPage(tab, { append: false });
              }}
            />
          </div>
        )}

        {/* Tab description */}
        <p className="mb-4 text-[13px] leading-relaxed text-tertiary">{TAB_META[tab].blurb}</p>

        {/* Feed */}
        {feedLoading ? (
          <PostSkeleton count={4} />
        ) : displayedItems.length === 0 ? (
          tab === "following" ? (
            /* Distinct from an empty platform: there is plenty to read, the viewer
               just hasn't followed anyone. Point them at the timeline that works
               without a follow graph rather than at the composer. */
            <EmptyState
              icon={Users}
              title={
                followingIds && followingIds.length > 0
                  ? "Nothing new from the people you follow"
                  : "You're not following anyone yet"
              }
              description={
                followingIds && followingIds.length > 0
                  ? "When they post or re-ship something, it lands here."
                  : "Follow a few builders and their posts — and anything they re-ship — will collect here. Explore is where everyone is."
              }
              action={
                <Link
                  to="/search"
                  search={{ q: undefined, tab: undefined }}
                  className="btn btn-primary btn-sm"
                >
                  Find builders
                </Link>
              }
            />
          ) : (
            /* The empty state has to account for the tier split, or it lies. An
               unverified reader offered "write the first post" on an empty Signal
               would post, watch Signal stay empty, and reasonably call it broken —
               their post went to Beat, because that is what these tabs mean. */
            <EmptyState
              icon={tab === "signal" ? Rss : Sparkles}
              title={tab === "signal" ? "Nothing on Signal yet" : "Nothing on Beat yet"}
              description={emptyTabDescription(tab as TierTab)}
              action={
                user && viewerPostsLandIn(tab as TierTab) ? (
                  <button
                    type="button"
                    onClick={() => setShowModal(true)}
                    className="btn btn-primary btn-sm"
                  >
                    Write the first post
                  </button>
                ) : user && profile && tab === "signal" ? (
                  // Straight to the form. This used to point at the member's own
                  // profile, which left them to discover that the portal was inside
                  // the Edit-profile sheet — so the link did not actually lead
                  // anywhere useful.
                  <Link
                    to="/verification"
                    search={{ fee: undefined }}
                    className="btn btn-secondary btn-sm"
                  >
                    Apply for verification
                  </Link>
                ) : undefined
              }
            />
          )
        ) : (
          <>
            {user && profile ? (
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="card card-interactive mb-3 hidden w-full items-center gap-3 p-4 text-left sm:flex"
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full text-[13px] font-bold"
                  style={{
                    background: tierVisual(profile.verification_tier).fill,
                    color: tierVisual(profile.verification_tier).ink,
                  }}
                >
                  {profile.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt=""
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    profile.display_name.charAt(0).toUpperCase()
                  )}
                </span>
                <span className="flex-1 text-[15px] text-tertiary">
                  What are you shipping today?
                </span>
                <span className="btn btn-primary btn-sm shrink-0">Post</span>
              </button>
            ) : null}

            <div className="space-y-3">
              {displayedItems.map((item) => (
                <PostCard
                  key={item.key}
                  post={item.post}
                  repostedBy={item.repostedBy}
                  stats={stats.get(item.post.id)}
                  onDownload={requestExport}
                  currentUserId={user?.id}
                  onDeleted={removePostFromLists}
                  onEdited={applyEdit}
                />
              ))}
            </div>

            {/*
              The timeline was previously capped at the newest 200 posts with no
              way to reach anything older — once the platform passed 200 posts,
              earlier ones became permanently unreachable.
            */}
            {(tab === "following" ? followingHasMore : feeds[tab].hasMore) && (
              <button
                type="button"
                onClick={tab === "following" ? loadMoreFollowing : loadMore}
                disabled={loadingMore}
                className="btn btn-outline btn-block mt-6"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </>
                ) : (
                  "Load older posts"
                )}
              </button>
            )}
          </>
        )}
      </main>

      {/* Floating action button: hides while scrolling, reappears on stop */}
      {user && (
        <button
          type="button"
          onClick={() => setShowModal(true)}
          aria-label="Write a new card"
          /* Mobile only: desktop now has the inline composer at the top of the
             timeline, and keeping both put two "new post" controls on one screen. */
          className="fixed right-5 z-40 flex items-center justify-center rounded-full transition-all duration-300 active:scale-95 sm:hidden"
          style={{
            bottom: "calc(env(safe-area-inset-bottom) + var(--mobile-nav-height) + 1rem)",
            width: "58px",
            height: "58px",
            /* Neutral, not amber. A core action should not borrow the badge's
               colour to look important, nor change colour per viewer. */
            background: ACTION_SURFACE,
            color: ACTION_INK,
            boxShadow: "0 8px 28px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.40)",
            opacity: fabVisible ? 1 : 0,
            transform: fabVisible ? "scale(1)" : "scale(0.75)",
            pointerEvents: fabVisible ? "auto" : "none",
          }}
        >
          <Plus className="h-6 w-6" strokeWidth={2.5} />
        </button>
      )}

      {/* Composer Modal */}
      {showModal && (
        <ComposerModal
          onClose={() => setShowModal(false)}
          onPublished={(post) => {
            /*
              Placed by the author's tier, exactly as the queries and the realtime
              handler do it. The realtime INSERT will arrive for this post too, and
              both paths skip a post already in the list, so it lands once.
            */
            setFeeds((prev) => {
              const next = { ...prev };
              for (const key of Object.keys(next) as TierTab[]) {
                if (!TAB_AUTHOR_TIERS[key].includes(post.author.verification_tier)) continue;
                const current = next[key];
                if (current.posts === null) continue;
                if (current.posts.some((p) => p.id === post.id)) continue;
                next[key] = { ...current, posts: [post, ...current.posts] };
              }
              return next;
            });
          }}
        />
      )}

      {exportSurface}
    </div>
  );
}

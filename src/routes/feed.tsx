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
 * Signal and Beat are two cuts of the same global timeline, split by post shape.
 * Following is a different axis — a narrower audience, not a different kind of
 * post — and it is deliberately an *additional* lens rather than the default.
 *
 * The Ledger's premise is one chronological feed where a first post is as visible
 * as a thousandth; making Following the landing tab would quietly turn it into a
 * follower-count game, which is the thing this platform exists not to be.
 */
type FeedTab = "signal" | "beat" | "following";

const POST_SELECT =
  "id, content, background, comments_enabled, visibility, created_at, edited_at, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, verification_tier)";

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
  // The two tabs split one global timeline by post background, not by tier.
  // Signal was verified-only until 2026-07-20 (6b5085f), when it was opened to
  // all tiers and re-cut as text-posts-vs-Studio-cards; the tab copy below was
  // updated to match, but these comments were left behind.
  const [beatPosts, setBeatPosts] = useState<FeedPost[] | null>(null); // Beat: Studio cards
  const [signalPosts, setSignalPosts] = useState<FeedPost[] | null>(null); // Signal: text posts
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
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [oldestLoaded, setOldestLoaded] = useState<string | null>(null);
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
    });
    const map = new Map<string, PostStats>(ids.map((id) => [id, blank()]));
    if (ids.length === 0) return map;

    const [likes, reposts, comments] = await Promise.all([
      supabase.from("likes").select("post_id, user_id").in("post_id", ids),
      supabase.from("reposts").select("post_id, user_id").in("post_id", ids),
      supabase.from("comments").select("post_id").in("post_id", ids),
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
  async function loadPage(opts: { before?: string; append: boolean }) {
    let query = supabase
      .from("posts")
      .select(POST_SELECT)
      .order("created_at", { ascending: false })
      .limit(FEED_PAGE_SIZE);
    if (opts.before) query = query.lt("created_at", opts.before);

    const { data, error } = await query;

    if (error) {
      setFeedError("Couldn't load the feed. Check your connection and try again.");
      if (!opts.append) {
        setSignalPosts([]);
        setBeatPosts([]);
      }
      return;
    }

    setFeedError(null);
    const page = normalisePosts((data ?? []) as RawFeedRow[]);
    setHasMore(page.length === FEED_PAGE_SIZE);
    if (page.length > 0) setOldestLoaded(page[page.length - 1].created_at);

    const pageStats = await fetchStats(
      page.map((p) => p.id),
      user?.id,
    );
    setStats((prev) => {
      const next = new Map(opts.append ? prev : []);
      pageStats.forEach((value, key) => next.set(key, value));
      return next;
    });

    const visible = withoutMuted(page);
    const signal = visible.filter((p) => !p.background || p.background === "noir");
    const beat = visible.filter((p) => p.background && p.background !== "noir");

    if (opts.append) {
      setSignalPosts((prev) => [...(prev ?? []), ...signal]);
      setBeatPosts((prev) => [...(prev ?? []), ...beat]);
    } else {
      setSignalPosts(signal);
      setBeatPosts(beat);
    }
  }

  async function loadMore() {
    if (loadingMore || !hasMore || !oldestLoaded) return;
    setLoadingMore(true);
    await loadPage({ before: oldestLoaded, append: true });
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
    setSignalPosts((prev) => (prev ? prev.filter((p) => !mutedIds.has(p.author.id)) : prev));
    setBeatPosts((prev) => (prev ? prev.filter((p) => !mutedIds.has(p.author.id)) : prev));
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
    loadPage({ append: false });

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
          const isCard = fresh.background && fresh.background !== "noir";
          const setter = isCard ? setBeatPosts : setSignalPosts;
          setter((prev) => {
            if (prev?.some((p) => p.id === fresh.id)) return prev;
            return prev ? [fresh, ...prev] : [fresh];
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
        setSignalPosts((prev) => prev?.filter((p) => p.id !== id) ?? null);
        setBeatPosts((prev) => prev?.filter((p) => p.id !== id) ?? null);
        setFollowingItems((prev) => prev?.filter((i) => i.post.id !== id) ?? null);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /*
    Signal and Beat are both pre-loaded at mount from one query, so switching
    between them is instant. Following is fetched on first open instead: it is a
    different query against a list the viewer may not even have, and paying for it
    on every feed visit would slow the common case down for the rarer one.
  */
  const displayedItems: TimelineItem[] =
    tab === "following"
      ? (followingItems ?? [])
      : (tab === "signal" ? (signalPosts ?? []) : (beatPosts ?? [])).map((post) => ({
          key: `post:${post.id}`,
          post,
          timelineAt: post.created_at,
        }));

  const feedLoading =
    tab === "following"
      ? followingItems === null
      : tab === "signal"
        ? signalPosts === null
        : beatPosts === null;

  // Following is meaningless without an account to follow from.
  const visibleTabs: FeedTab[] = user ? ["signal", "beat", "following"] : ["signal", "beat"];

  const TAB_META: Record<FeedTab, { label: string; icon: typeof Rss; blurb: string }> = {
    signal: {
      label: "Signal",
      icon: Rss,
      blurb: "All builders, all tiers — the live pulse of everything being shipped.",
    },
    beat: {
      label: "Beat",
      icon: Sparkles,
      blurb: "Studio cards — crafted status posts from every builder on the platform.",
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
    setSignalPosts((prev) => prev?.map(patch) ?? null);
    setBeatPosts((prev) => prev?.map(patch) ?? null);
    setFollowingItems(
      (prev) => prev?.map((i) => (i.post.id === id ? { ...i, post: patch(i.post) } : i)) ?? null,
    );
  }

  function removePostFromLists(id: string) {
    setBeatPosts((prev) => prev?.filter((x) => x.id !== id) ?? null);
    setSignalPosts((prev) => prev?.filter((x) => x.id !== id) ?? null);
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
        <div className="mx-auto max-w-2xl px-4 pb-3 pt-1 sm:px-6">
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

      <main className="page-enter mx-auto max-w-2xl px-4 pb-mobile-nav pt-5 sm:px-6">
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
            <ErrorState message={feedError} onRetry={() => loadPage({ append: false })} />
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
            <EmptyState
              icon={tab === "signal" ? Rss : Sparkles}
              title={tab === "signal" ? "No posts yet" : "No studio cards yet"}
              description={
                tab === "signal"
                  ? "Signal carries every text post on the platform. Be the first to ship something worth reading."
                  : "Cards crafted in the Studio land here. Make one and it appears instantly."
              }
              action={
                user ? (
                  <button
                    type="button"
                    onClick={() => setShowModal(true)}
                    className="btn btn-primary btn-sm"
                  >
                    Write the first post
                  </button>
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
            {(tab === "following" ? followingHasMore : hasMore) && (
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
            // Signal = noir/text posts; Beat = studio card posts (non-noir)
            const isCardPost = post.background && post.background !== "noir";
            if (isCardPost) {
              setBeatPosts((prev) => (prev ? [post, ...prev] : [post]));
            } else {
              setSignalPosts((prev) => (prev ? [post, ...prev] : [post]));
            }
          }}
        />
      )}

      {exportSurface}
    </div>
  );
}

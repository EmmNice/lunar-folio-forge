import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2, ShieldAlert, Rss, Sparkles } from "lucide-react";
import { EmptyState, ErrorState, PostSkeleton } from "@/components/states";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader, MobileNav } from "@/components/AppHeader";
import { toBackground } from "@/components/StatusCard";
import { PostCard, type FeedPost, type PostStats } from "@/components/PostCard";
import { ComposerModal } from "@/components/ComposerModal";
import { useAuth } from "@/hooks/use-auth";
import type { VerificationTier } from "@/hooks/use-auth";
import { useCardExport } from "@/hooks/use-card-export";
import { FEED_PAGE_SIZE } from "@/lib/limits";

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

type FeedTab = "signal" | "beat";

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
  const [showModal, setShowModal] = useState(false);
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
    const FULL_SELECT = `id, content, background, comments_enabled, visibility, created_at, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, verification_tier)`;

    let query = supabase
      .from("posts")
      .select(FULL_SELECT)
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

    const signal = page.filter((p) => !p.background || p.background === "noir");
    const beat = page.filter((p) => p.background && p.background !== "noir");

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
            .select(
              `id, content, background, comments_enabled, visibility, created_at, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, verification_tier)`,
            )
            .eq("id", id)
            .maybeSingle();
          // RLS decides whether this viewer is in the audience; a whisper post
          // from someone else simply comes back empty here.
          if (!data) return;
          const [fresh] = normalisePosts([data as unknown as RawFeedRow]);
          if (!fresh) return;
          const isCard = fresh.background && fresh.background !== "noir";
          const setter = isCard ? setBeatPosts : setSignalPosts;
          setter((prev) => {
            if (prev?.some((p) => p.id === fresh.id)) return prev;
            return prev ? [fresh, ...prev] : [fresh];
          });
        },
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "posts" }, (payload) => {
        const id = (payload.old as { id?: string }).id;
        if (!id) return;
        setSignalPosts((prev) => prev?.filter((p) => p.id !== id) ?? null);
        setBeatPosts((prev) => prev?.filter((p) => p.id !== id) ?? null);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Instant tab switch — both caches pre-loaded at mount
  const displayedPosts = tab === "signal" ? (signalPosts ?? []) : (beatPosts ?? []);
  const feedLoading = tab === "signal" ? signalPosts === null : beatPosts === null;

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
            <div className="segmented sm:max-w-[18rem]">
              {(["signal", "beat"] as FeedTab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  data-active={tab === t}
                  className="segmented-item"
                >
                  {t === "signal" ? (
                    <Rss className="h-3.5 w-3.5" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {t === "signal" ? "Signal" : "Beat"}
                </button>
              ))}
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
        <p className="mb-4 text-[13px] leading-relaxed text-tertiary">
          {tab === "signal"
            ? "All builders, all tiers — the live pulse of everything being shipped."
            : "Studio cards — crafted status posts from every builder on the platform."}
        </p>

        {/* Feed */}
        {feedLoading ? (
          <PostSkeleton count={4} />
        ) : displayedPosts.length === 0 ? (
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
                  style={{ background: "rgba(251,191,36,0.16)", color: "var(--gold)" }}
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
              {displayedPosts.map((p) => (
                <PostCard
                  key={p.id}
                  post={p}
                  stats={stats.get(p.id)}
                  onDownload={requestExport}
                  currentUserId={user?.id}
                  onDeleted={(id) => {
                    setBeatPosts((prev) => prev?.filter((x) => x.id !== id) ?? null);
                    setSignalPosts((prev) => prev?.filter((x) => x.id !== id) ?? null);
                  }}
                />
              ))}
            </div>

            {/*
              The timeline was previously capped at the newest 200 posts with no
              way to reach anything older — once the platform passed 200 posts,
              earlier ones became permanently unreachable.
            */}
            {hasMore && (
              <button
                type="button"
                onClick={loadMore}
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
            background: "#FBBF24",
            color: "#0B0B0C",
            boxShadow: "0 8px 32px rgba(251,191,36,0.35), 0 2px 8px rgba(0,0,0,0.40)",
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

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { toPng } from "html-to-image";
import { Loader2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatusCard, BACKGROUND_BASE_COLORS } from "@/components/StatusCard";
import { AppHeader, MobileNav } from "@/components/AppHeader";
import { PostCard, type FeedPost } from "@/components/PostCard";
import { ComposerModal } from "@/components/ComposerModal";
import { useAuth } from "@/hooks/use-auth";
import type { Background } from "@/components/StatusCard";

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

// ─── Main feed page ──────────────────────────────────────────────────────────
function FeedPage() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<FeedTab>("signal");
  const [beatPosts, setBeatPosts] = useState<FeedPost[] | null>(null);   // Beat: all posts
  const [signalPosts, setSignalPosts] = useState<FeedPost[] | null>(null); // Signal: verified only
  const [showModal, setShowModal] = useState(false);
  const [fabVisible, setFabVisible] = useState(true);
  const [headerHidden, setHeaderHidden] = useState(false);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const [exportPost, setExportPost] = useState<FeedPost | null>(null);

  // ── Redirect unonboarded users ──────────────────────────────────────────
  useEffect(() => {
    if (loading) return;
    if (user && profile && !profile.onboarding_completed) {
      navigate({ to: "/onboarding", replace: true });
    }
  }, [loading, user, profile, navigate]);

  // ── FAB visibility: hide while scrolling, reappear when scroll stops ───
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

  // ── Shared visibility filter ──────────────────────────────────────────
  function applyVisibility(all: FeedPost[]): FeedPost[] {
    // Only authenticated, verified members can see restricted posts
    const isVerifiedViewer =
      !!user && !!profile &&
      (profile.verification_tier === "silver" ||
      profile.verification_tier === "gold");
    const isSilverOrGold =
      profile?.verification_tier === "silver" || profile?.verification_tier === "gold";
    return all
      .filter((p) => isVerifiedViewer || (p.visibility ?? "public") === "public")
      .filter((p) => isSilverOrGold  || (p.visibility ?? "public") !== "whisper");
  }

  // ── Shared row normaliser ─────────────────────────────────────────────
  function normalisePosts(data: any[]): FeedPost[] {
    return data.map((p) => ({
      ...p,
      comments_enabled: p.comments_enabled ?? true,
      visibility: p.visibility ?? "public",
    }));
  }

  // ── Single fetch, split client-side ──────────────────────────────────────
  // Signal = noir/null background (plain text posts), all tiers
  // Beat   = any non-noir background (Studio cards), all tiers
  async function fetchAllPosts() {
    const FULL_SELECT =
      `id, content, background, comments_enabled, visibility, created_at, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, verification_tier)`;

    const { data, error } = await supabase
      .from("posts")
      .select(FULL_SELECT)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      toast.error("Couldn't load the feed. Check your connection.");
      setSignalPosts([]);
      setBeatPosts([]);
      return;
    }

    const all = applyVisibility(normalisePosts(data ?? []));
    setSignalPosts(all.filter((p) => !p.background || p.background === "noir"));
    setBeatPosts(all.filter((p) => p.background && p.background !== "noir"));
  }

  useEffect(() => {
    fetchAllPosts();

    const channel = supabase
      .channel("public:posts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, () => {
        fetchAllPosts();
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "posts" }, () => {
        fetchAllPosts();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── Graphic export handler ──────────────────────────────────────────────
  useEffect(() => {
    if (!exportPost || !exportRef.current) return;
    (async () => {
      try {
        const dataUrl = await toPng(exportRef.current!, {
          pixelRatio: 1,
          cacheBust: true,
          backgroundColor: BACKGROUND_BASE_COLORS[exportPost.background] ?? "#0b0b0c",
          width: 1080,
          height: 1920,
        });
        const link = document.createElement("a");
        link.download = `${exportPost.author.handle}-status.png`;
        link.href = dataUrl;
        link.click();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Export failed.");
      } finally {
        setExportPost(null);
      }
    })();
  }, [exportPost]);

  // Instant tab switch — both caches pre-loaded at mount
  const displayedPosts = tab === "signal" ? (signalPosts ?? []) : (beatPosts ?? []);
  const feedLoading   = tab === "signal" ? signalPosts === null : beatPosts === null;

  return (
    <div className="min-h-screen pb-16 sm:pb-0">

      {/*
        ── Combined sticky header: top nav + Signal/Beat tabs as ONE unit ──
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
          transition: headerHidden
            ? "transform 0.15s ease-out"
            : "transform 0.08s ease-out",
          transform: headerHidden ? "translateY(-100%)" : "translateY(0)",
          willChange: "transform",
        }}
      >
        {/* Top nav bar — controlled mode: no internal scroll listener, no sticky/transform of its own */}
        <AppHeader controlled />

        {/* Signal / Beat tab switcher */}
        <div
          className="px-4 pt-2 pb-2.5 sm:px-6"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="mx-auto max-w-2xl">
            <div className="flex gap-0.5 rounded-xl border border-border/50 bg-secondary/15 p-1">
              {(["signal", "beat"] as FeedTab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={
                    "flex-1 rounded-[9px] py-[7px] text-[13px] font-medium transition-all duration-150 " +
                    (tab === t
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground/80")
                  }
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile bottom nav — outside the transformed header so position:fixed works correctly */}
      <MobileNav />

      <main className="mx-auto max-w-2xl px-4 pt-5 pb-32 sm:px-6 page-enter">
        {/* Tab description */}
        <p className="mb-5 text-[12px] leading-relaxed text-muted-foreground/70">
          {tab === "signal"
            ? "All builders, all tiers — the live pulse of everything being shipped."
            : "Studio cards — crafted status posts from every builder on the platform."}
        </p>

        {/* ── Feed ── */}
        {feedLoading ? (
          <div className="space-y-4" aria-label="Loading feed…">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-2xl border border-border/40 bg-card/30 p-5">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-secondary/60" />
                  <div className="min-w-0 flex-1 space-y-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-3.5 w-28 animate-pulse rounded-full bg-secondary/60" style={{ animationDelay: `${i * 80}ms` }} />
                      <div className="h-3 w-16 animate-pulse rounded-full bg-secondary/40" style={{ animationDelay: `${i * 80 + 40}ms` }} />
                    </div>
                    <div className="space-y-2">
                      <div className="h-3.5 w-full animate-pulse rounded-full bg-secondary/50" style={{ animationDelay: `${i * 80 + 80}ms` }} />
                      <div className="h-3.5 w-4/5 animate-pulse rounded-full bg-secondary/40" style={{ animationDelay: `${i * 80 + 120}ms` }} />
                      {i % 2 === 0 && <div className="h-3.5 w-2/3 animate-pulse rounded-full bg-secondary/30" style={{ animationDelay: `${i * 80 + 160}ms` }} />}
                    </div>
                    <div className="flex gap-5 pt-1">
                      {[20, 16, 16, 14].map((w, j) => (
                        <div key={j} className={`h-3 w-${w} animate-pulse rounded-full bg-secondary/30`} style={{ animationDelay: `${i * 80 + j * 30}ms` }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : displayedPosts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 p-12 text-center">
            {tab === "signal" ? (
              <>
                <p className="text-sm font-semibold text-foreground">No posts yet</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Signal shows all text posts from every builder.
                  <br />
                  Be the first to ship something worth reading.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-foreground">No studio cards yet</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Cards crafted in the Studio will appear here.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {displayedPosts.map((p) => (
              <PostCard
                key={p.id}
                post={p}
                onDownload={setExportPost}
                currentUserId={user?.id}
                onDeleted={(id) => {
                  setBeatPosts((prev) => prev?.filter((x) => x.id !== id) ?? null);
                  setSignalPosts((prev) => prev?.filter((x) => x.id !== id) ?? null);
                }}
              />
            ))}
          </div>
        )}
      </main>

      {/* ── Floating Action Button ── hides while scrolling, reappears on stop ── */}
      {user && (
        <button
          type="button"
          onClick={() => setShowModal(true)}
          aria-label="Write a new card"
          className="fixed right-5 z-40 flex items-center justify-center rounded-full transition-all duration-300 active:scale-95 sm:right-8"
          style={{
            bottom: "calc(env(safe-area-inset-bottom) + 76px)",
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

      {/* ── Composer Modal ── */}
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

      {/* Off-screen full-res render for PostCard downloads */}
      {exportPost && (
        <div
          aria-hidden
          style={{ position: "fixed", top: 0, left: 0, pointerEvents: "none", opacity: 0, zIndex: -1 }}
        >
          <StatusCard
            ref={exportRef}
            name={exportPost.author.display_name}
            handle={exportPost.author.handle}
            avatarUrl={exportPost.author.avatar_url}
            content={exportPost.content}
            background={exportPost.background}
            verificationTier={exportPost.author.verification_tier}
            watermark
            exportMode
          />
        </div>
      )}
    </div>
  );
}

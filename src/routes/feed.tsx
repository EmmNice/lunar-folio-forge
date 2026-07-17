import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { toPng } from "html-to-image";
import { Loader2, Plus, Send, X, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatusCard, BACKGROUND_BASE_COLORS } from "@/components/StatusCard";
import { AppHeader, MobileNav } from "@/components/AppHeader";
import { PostCard, type FeedPost } from "@/components/PostCard";
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

const MAX = 280;
type FeedTab = "signal" | "beat";

// ─── Quick Composer Modal ────────────────────────────────────────────────────
function ComposerModal({
  onClose,
  onPublished,
}: {
  onClose: () => void;
  onPublished: (post: FeedPost) => void;
}) {
  const { user, profile } = useAuth();
  const [composer, setComposer] = useState("");
  const [background, setBackground] = useState<Background>("noir");
  const [busy, setBusy] = useState<"publish" | "download" | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const [exportData, setExportData] = useState<FeedPost | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on open
  useEffect(() => { textareaRef.current?.focus(); }, []);

  // Handle graphic export
  useEffect(() => {
    if (!exportData || !exportRef.current) return;
    (async () => {
      try {
        const dataUrl = await toPng(exportRef.current!, {
          pixelRatio: 1,
          cacheBust: true,
          backgroundColor: BACKGROUND_BASE_COLORS[exportData.background] ?? "#0b0b0c",
          width: 1080,
          height: 1920,
        });
        const link = document.createElement("a");
        link.download = `${exportData.author.handle}-status.png`;
        link.href = dataUrl;
        link.click();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Export failed.");
      } finally {
        setExportData(null);
        setBusy(null);
      }
    })();
  }, [exportData]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function publish() {
    if (!user || !profile) { toast.error("Sign in to publish."); return; }
    const body = composer.trim();
    if (!body) return;
    if (body.length > MAX) { toast.error(`Posts are limited to ${MAX} characters.`); return; }
    setBusy("publish");
    const { data, error } = await supabase
      .from("posts")
      .insert({ author_id: profile.id, content: body, background })
      .select("id, content, background, created_at")
      .single();
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Published live to The Ledger.");
    onPublished({
      id: data.id,
      content: data.content,
      background: data.background as Background,
      comments_enabled: true,
      visibility: "public",
      created_at: data.created_at,
      author: {
        id: profile.id,
        handle: profile.handle,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        verification_tier: profile.verification_tier,
      },
    });
    onClose();
  }

  async function downloadGraphic() {
    if (!profile) { toast.error("Sign in to create a graphic."); return; }
    const body = composer.trim();
    if (!body) { toast.error("Write something first."); return; }
    setBusy("download");
    setExportData({
      id: "draft",
      content: body,
      background,
      comments_enabled: true,
      visibility: "public",
      created_at: new Date().toISOString(),
      author: {
        id: profile.id,
        handle: profile.handle,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        verification_tier: profile.verification_tier,
      },
    });
  }

  const remaining = MAX - composer.length;

  const bgBtn = (active: boolean) =>
    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors " +
    (active
      ? "border-foreground bg-foreground text-background"
      : "border-border text-muted-foreground hover:text-foreground");

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Modal */}
      <div
        className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+80px)] z-50 mx-auto max-w-lg rounded-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2"
        style={{
          background: "rgba(20,20,24,0.98)",
          border: "1px solid rgba(255,255,255,0.10)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
        }}
      >
        {/* Modal header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <p className="text-sm font-semibold tracking-tight">New Card</p>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
            style={{ background: "rgba(255,255,255,0.05)" }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Composer body */}
        <div className="px-5 py-4">
          {/* Author chip */}
          {profile && (
            <div className="mb-4 flex items-center gap-2.5">
              <div
                className="grid h-8 w-8 shrink-0 overflow-hidden rounded-full text-xs font-semibold"
                style={{ border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.05)" }}
              >
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="grid h-full w-full place-items-center">
                    {profile.display_name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div>
                <p className="text-[13px] font-medium">{profile.display_name}</p>
                <p className="text-[11px] text-muted-foreground">@{profile.handle}</p>
              </div>
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={4}
            maxLength={MAX + 40}
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            placeholder="What's happening in your build today?"
            className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
          />

          {/* Card style */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground/70">Style:</span>
            <button type="button" onClick={() => setBackground("noir")} className={bgBtn(background === "noir")}>
              Tech Noir
            </button>
            <button type="button" onClick={() => setBackground("cream")} className={bgBtn(background === "cream")}>
              Premium Cream
            </button>
          </div>
        </div>

        {/* Footer actions */}
        <div
          className="flex items-center justify-between px-5 py-3.5"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          <span
            className={
              "text-xs tabular-nums transition-colors " +
              (remaining < 0
                ? "font-medium text-red-400"
                : remaining <= 20
                  ? "font-medium text-amber-400"
                  : "text-muted-foreground/60")
            }
          >
            {remaining}
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={downloadGraphic}
              disabled={busy !== null || !composer.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-40"
            >
              {busy === "download" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
              Graphic
            </button>
            <button
              type="button"
              onClick={publish}
              disabled={busy !== null || !composer.trim() || remaining < 0}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: "#F5F5F6" }}
            >
              {busy === "publish" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Publish
            </button>
          </div>
        </div>
      </div>

      {/* Off-screen export render */}
      {exportData && (
        <div aria-hidden style={{ position: "fixed", top: 0, left: 0, pointerEvents: "none", opacity: 0, zIndex: -1 }}>
          <StatusCard
            ref={exportRef}
            name={exportData.author.display_name}
            handle={exportData.author.handle}
            avatarUrl={exportData.author.avatar_url}
            content={exportData.content}
            background={exportData.background}
            verificationTier={exportData.author.verification_tier}
            watermark
            exportMode
          />
        </div>
      )}
    </>
  );
}

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

  // ── FAB + combined-header scroll visibility ─────────────────────────────
  // Mirrors X's "For You / Following" behaviour:
  //   • Any downward movement past the header height → hide immediately
  //   • Any upward movement (even 1 px) → show immediately
  useEffect(() => {
    let lastY = window.scrollY;
    function onScroll() {
      const y = window.scrollY;
      const delta = y - lastY;
      if (delta > 0 && y > 56) {
        // Scrolling down and past the top bar — hide both header and FAB
        setFabVisible(false);
        setHeaderHidden(true);
      } else if (delta < 0) {
        // Any upward motion — show both immediately
        setFabVisible(true);
        setHeaderHidden(false);
      }
      lastY = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // ── Shared visibility filter ──────────────────────────────────────────
  function applyVisibility(all: FeedPost[]): FeedPost[] {
    const isVerifiedViewer =
      !user || !profile ||
      profile.verification_tier === "silver" ||
      profile.verification_tier === "gold";
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

  // ── Beat fetch: ALL posts, strictly chronological ──────────────────────
  // Two-step: try with optional columns first; fall back to base schema if
  // they don't exist yet (e.g. migrations not applied).
  async function fetchBeat() {
    const BASE_SELECT =
      "id, content, background, created_at, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, verification_tier)";
    const FULL_SELECT =
      `id, content, background, comments_enabled, visibility, created_at, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, verification_tier)`;

    let data: any[] | null = null;

    const full = await supabase
      .from("posts")
      .select(FULL_SELECT)
      .order("created_at", { ascending: false })
      .limit(80);

    if (full.error) {
      // Column probably doesn't exist yet — retry without optional columns
      const base = await supabase
        .from("posts")
        .select(BASE_SELECT)
        .order("created_at", { ascending: false })
        .limit(80);

      if (base.error) {
        toast.error("Couldn't load the feed. Check your connection.");
        setBeatPosts([]);
        return;
      }
      data = base.data;
    } else {
      data = full.data;
    }

    setBeatPosts(applyVisibility(normalisePosts(data ?? [])));
  }

  // ── Signal fetch: VERIFIED AUTHORS ONLY — backend-filtered ─────────────
  // Uses !inner join so the DB only returns posts whose author has
  // verification_tier = 'silver' | 'gold'. Falls back to client-side filter
  // if the inner-join syntax isn't supported by the schema version.
  async function fetchSignal() {
    const BASE_SELECT =
      "id, content, background, created_at, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, verification_tier)";
    const FULL_SELECT =
      "id, content, background, comments_enabled, visibility, created_at, author:profiles!posts_author_id_fkey!inner(id, handle, display_name, avatar_url, verification_tier)";

    // Try backend-filtered query first
    const full = await supabase
      .from("posts")
      .select(FULL_SELECT)
      .in("profiles.verification_tier", ["silver", "gold"])
      .order("created_at", { ascending: false })
      .limit(50);

    if (!full.error) {
      setSignalPosts(applyVisibility(normalisePosts(full.data ?? [])));
      return;
    }

    // Fallback: base columns + client-side filter for verified authors
    const base = await supabase
      .from("posts")
      .select(BASE_SELECT)
      .order("created_at", { ascending: false })
      .limit(80);

    if (base.error) { setSignalPosts([]); return; }

    const verified = normalisePosts(base.data ?? []).filter(
      (p) => p.author.verification_tier === "silver" || p.author.verification_tier === "gold",
    );
    setSignalPosts(applyVisibility(verified));
  }

  useEffect(() => {
    // Fetch both tabs in parallel so switching is always instant
    fetchBeat();
    fetchSignal();

    const channel = supabase
      .channel("public:posts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, () => {
        fetchBeat();
        fetchSignal();
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "posts" }, () => {
        fetchBeat();
        fetchSignal();
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
            ? "Silver & Gold verified builders — the highest-signal posts on the platform."
            : "Raw chronological pulse of everything shipping — verified and unverified alike."}
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
                <p className="text-sm font-semibold text-foreground">No verified posts yet</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Signal shows only Silver & Gold verified builders.
                  <br />
                  Switch to{" "}
                  <button
                    type="button"
                    onClick={() => setTab("beat")}
                    className="font-medium text-foreground underline underline-offset-3 hover:opacity-80"
                  >
                    Beat
                  </button>{" "}
                  to see everything.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-foreground">Nothing here yet</p>
                <p className="mt-2 text-xs text-muted-foreground">Be the first to ship something.</p>
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

      {/* ── Floating Action Button ── */}
      {user && profile && (
        <button
          type="button"
          onClick={() => setShowModal(true)}
          aria-label="Write a new card"
          className="fixed right-5 z-40 flex items-center justify-center rounded-full shadow-2xl transition-all duration-300 sm:right-8"
          style={{
            bottom: "calc(env(safe-area-inset-bottom) + 72px)",
            width: "52px",
            height: "52px",
            background: "#F5F5F6",
            color: "#0B0B0C",
            boxShadow: "0 8px 32px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.30)",
            transform: fabVisible ? "scale(1) translateY(0)" : "scale(0.7) translateY(12px)",
            opacity: fabVisible ? 1 : 0,
            pointerEvents: fabVisible ? "auto" : "none",
          }}
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </button>
      )}

      {/* ── Composer Modal ── */}
      {showModal && (
        <ComposerModal
          onClose={() => setShowModal(false)}
          onPublished={(post) => {
            // Prepend to Beat immediately; Signal only gets it if author is verified
            setBeatPosts((prev) => (prev ? [post, ...prev] : [post]));
            const isVerified =
              post.author.verification_tier === "silver" ||
              post.author.verification_tier === "gold";
            if (isVerified) {
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

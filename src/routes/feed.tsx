import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { toPng } from "html-to-image";
import { Image as ImageIcon, Loader2, Send, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatusCard } from "@/components/StatusCard";
import { AppHeader } from "@/components/AppHeader";
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

function FeedPage() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<FeedTab>("signal");
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [composer, setComposer] = useState("");
  const [background, setBackground] = useState<Background>("noir");
  const [busy, setBusy] = useState<"publish" | "download" | null>(null);
  const [exportPost, setExportPost] = useState<FeedPost | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (loading) return;
    if (user && profile && !profile.onboarding_completed) {
      navigate({ to: "/onboarding", replace: true });
    }
  }, [loading, user, profile, navigate]);

  async function fetchAll() {
    let data: any[] | null = null;

    // Try full select including migration-002 columns first
    const fullRes = await supabase
      .from("posts")
      .select(
        "id, content, background, comments_enabled, visibility, created_at, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, verification_tier)",
      )
      .order("created_at", { ascending: false })
      .limit(80);

    if (fullRes.error) {
      // Migration-002 might not be applied — fall back to base columns only
      const baseRes = await supabase
        .from("posts")
        .select(
          "id, content, background, created_at, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, verification_tier)",
        )
        .order("created_at", { ascending: false })
        .limit(80);

      if (baseRes.error) {
        toast.error("Couldn't load the feed. Check your connection.");
        setPosts([]);
        return;
      }
      data = baseRes.data;
    } else {
      data = fullRes.data;
    }

    // Attach safe defaults for any missing migration-002 columns
    let all: FeedPost[] = (data ?? []).map((p: any) => ({
      ...p,
      comments_enabled: p.comments_enabled ?? true,
      visibility: p.visibility ?? "public",
    }));

    // Hide verified_only posts from unverified logged-in viewers
    const isVerifiedViewer =
      !user ||
      !profile ||
      profile.verification_tier === "silver" ||
      profile.verification_tier === "gold";

    if (!isVerifiedViewer) {
      all = all.filter((p) => (p.visibility ?? "public") === "public");
    }

    // Whisper Feed: always hidden from anyone who is not Silver or Gold
    // (including logged-out visitors — stricter than verified_only)
    const isSilverOrGold =
      profile?.verification_tier === "silver" || profile?.verification_tier === "gold";
    if (!isSilverOrGold) {
      all = all.filter((p) => (p.visibility ?? "public") !== "whisper");
    }

    setPosts(all);
  }

  useEffect(() => {
    fetchAll();
    const channel = supabase
      .channel("public:posts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, () => fetchAll())
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "posts" }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  // Depend only on user ID — not the full user/profile objects.
  // Object references change on every auth state refresh (token renewal etc.)
  // which would re-subscribe and re-fetch the entire feed on every refresh tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!exportPost || !exportRef.current) return;
    (async () => {
      try {
        const dataUrl = await toPng(exportRef.current!, {
          pixelRatio: 1,
          cacheBust: true,
          backgroundColor: exportPost.background === "noir" ? "#0b0b0c" : "#f5f0e6",
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

  async function publish() {
    if (!user || !profile) { toast.error("Sign in to publish."); return; }
    const body = composer.trim();
    if (!body) return;
    if (body.length > MAX) { toast.error(`Posts are limited to ${MAX} characters.`); return; }
    setBusy("publish");
    const { error } = await supabase.from("posts").insert({
      author_id: profile.id,
      content: body,
      background,
    });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    setComposer("");
    toast.success("Published live to The Ledger.");
  }

  async function downloadGraphic() {
    if (!profile) { toast.error("Sign in to create a graphic."); return; }
    const body = composer.trim();
    if (!body) { toast.error("Write something first."); return; }
    setBusy("download");
    setExportPost({
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
    setBusy(null);
  }

  const remaining = MAX - composer.length;

  // Signal: only show verified authors; Beat: everything
  const displayedPosts =
    tab === "signal"
      ? (posts ?? []).filter(
          (p) => p.author.verification_tier === "silver" || p.author.verification_tier === "gold",
        )
      : (posts ?? []);

  const bgBtn = (active: boolean) =>
    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors " +
    (active
      ? "border-foreground bg-foreground text-background"
      : "border-border text-muted-foreground hover:text-foreground");

  return (
    <div className="min-h-screen pb-16 sm:pb-0">
      <AppHeader />
      <main className="mx-auto max-w-2xl px-4 pt-8 pb-24 sm:px-6">
        {/* ── Header ── */}
        <div className="mb-6">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
            The Ledger
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Explore Feed
          </h1>
        </div>

        {/* ── Signal / Beat tabs ── */}
        <div className="mb-1 flex gap-0.5 rounded-xl border border-border/50 bg-secondary/15 p-1">
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

        <p className="mb-6 mt-2.5 text-[12px] leading-relaxed text-muted-foreground/80">
          {tab === "signal"
            ? "Silver & Gold verified builders — the highest-signal posts on the platform."
            : "Raw chronological pulse of everything shipping — verified and unverified alike."}
        </p>

        {/* ── Quick composer (signed-in users) ── */}
        {user && profile ? (
          <div className="mb-8 rounded-2xl border border-border/50 bg-card/50 p-4 transition-shadow focus-within:border-border/80 focus-within:shadow-md focus-within:shadow-black/20">
            <textarea
              rows={2}
              maxLength={MAX + 40}
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              placeholder="What's happening in your build today?"
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
            />
            <div className="mt-3 border-t border-border/40 pt-3">
              {/* Background picker */}
              <div className="mb-3 flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground/70">Card style:</span>
                <button
                  type="button"
                  onClick={() => setBackground("noir")}
                  className={bgBtn(background === "noir")}
                >
                  Tech Noir
                </button>
                <button
                  type="button"
                  onClick={() => setBackground("cream")}
                  className={bgBtn(background === "cream")}
                >
                  Premium Cream
                </button>
              </div>
              <div className="flex items-center justify-between gap-3">
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
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={downloadGraphic}
                    disabled={busy !== null || !composer.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-40"
                  >
                    {busy === "download" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImageIcon className="h-3.5 w-3.5" />
                    )}
                    Graphic
                  </button>
                  <button
                    type="button"
                    onClick={publish}
                    disabled={busy !== null || !composer.trim() || remaining < 0}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-1.5 text-xs font-semibold text-background transition-opacity hover:opacity-85 disabled:opacity-40"
                  >
                    {busy === "publish" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Publish
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Feed ── */}
        {posts === null ? (
          // Rich skeleton cards — match the shape of real PostCards
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
                onDeleted={(id) => setPosts((prev) => prev?.filter((x) => x.id !== id) ?? null)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Off-screen full-res render for export */}
      {exportPost ? (
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
      ) : null}
    </div>
  );
}

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
    // Select base columns that always exist. comments_enabled / visibility are
    // added by migration 002 — they default gracefully until that runs.
    const { data, error } = await supabase
      .from("posts")
      .select(
        "id, content, background, created_at, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, verification_tier)",
      )
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) {
      toast.error("Couldn't load the feed.");
      setPosts([]);
      return;
    }

    // Attach safe defaults for migration-002 columns
    let all: FeedPost[] = (data ?? []).map((p: any) => ({
      ...p,
      comments_enabled: p.comments_enabled ?? true,
      visibility: p.visibility ?? "public",
    }));

    // Hide verified_only posts from unverified viewers
    const isVerifiedViewer =
      !user ||
      !profile ||
      profile.verification_tier === "silver" ||
      profile.verification_tier === "gold";

    if (!isVerifiedViewer) {
      all = all.filter((p) => (p.visibility ?? "public") === "public");
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
        <div className="mb-6 flex gap-1 rounded-xl border border-border/60 bg-secondary/20 p-1">
          <button
            type="button"
            onClick={() => setTab("signal")}
            className={
              "flex-1 rounded-lg py-2 text-sm font-medium transition-colors " +
              (tab === "signal"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            Signal
          </button>
          <button
            type="button"
            onClick={() => setTab("beat")}
            className={
              "flex-1 rounded-lg py-2 text-sm font-medium transition-colors " +
              (tab === "beat"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            Beat
          </button>
        </div>

        {tab === "signal" && (
          <p className="mb-5 text-xs text-muted-foreground">
            Silver & Gold verified builders only — the highest-signal posts on the platform.
          </p>
        )}
        {tab === "beat" && (
          <p className="mb-5 text-xs text-muted-foreground">
            Raw chronological pulse of everything shipping — verified and unverified alike.
          </p>
        )}

        {/* ── Composer (signed-in users) ── */}
        {user && profile ? (
          <div className="mb-8 rounded-2xl border border-border/60 bg-card/40 p-4">
            <textarea
              rows={2}
              maxLength={MAX + 40}
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              placeholder="What's happening in your build today?"
              className="w-full resize-none border-0 bg-transparent text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
            />
            <div className="mt-3 border-t border-border/50 pt-3">
              {/* Background picker */}
              <div className="mb-3 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Card:</span>
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
                    "text-xs tabular-nums " +
                    (remaining < 0
                      ? "text-red-400"
                      : remaining <= 20
                        ? "text-amber-400"
                        : "text-muted-foreground")
                  }
                >
                  {remaining}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={downloadGraphic}
                    disabled={busy !== null || !composer.trim()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    {busy === "download" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImageIcon className="h-3.5 w-3.5" />
                    )}
                    Download Graphic
                  </button>
                  <button
                    type="button"
                    onClick={publish}
                    disabled={busy !== null || !composer.trim() || remaining < 0}
                    className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {busy === "publish" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Publish Live
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Feed ── */}
        {posts === null ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-32 rounded-2xl border border-border/40 bg-card/30 animate-pulse" />
            ))}
          </div>
        ) : displayedPosts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center">
            {tab === "signal" ? (
              <>
                <p className="text-sm font-medium text-foreground">No verified posts yet</p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Signal only shows Silver & Gold verified builders.
                  <br />
                  Switch to <button type="button" onClick={() => setTab("beat")} className="font-medium text-foreground underline underline-offset-2">Beat</button> to see all posts — verified and unverified.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">Nothing here yet</p>
                <p className="mt-1.5 text-xs text-muted-foreground">Be the first to ship something.</p>
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

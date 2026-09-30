import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, EyeOff } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { PostCard, type FeedPost, type PostStats } from "@/components/PostCard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCardExport } from "@/hooks/use-card-export";
import { POST_SELECT, fetchPostStats } from "@/lib/post-query";

export const Route = createFileRoute("/p/$id")({
  head: () => ({
    meta: [
      { title: "Post — The Ledger" },
      {
        name: "description",
        content: "A card from The Ledger — a high-signal network for tech founders and builders.",
      },
    ],
  }),
  component: PostPermalinkPage,
});

/**
 * A single post, by id. This is where a shared link lands.
 *
 * Deliberately not gated behind `_authenticated`: the point of sharing a post to
 * X or WhatsApp is that whoever taps the link can read it. What they are allowed
 * to see is already decided by the posts SELECT policy and `can_view_post`, so a
 * whisper or verified-only card returns nothing here for a visitor who may not
 * read it — the same answer the API would give. No audience check is duplicated
 * in this component, because a check written twice is a check that can disagree.
 */
function PostPermalinkPage() {
  const { id } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { requestExport, exportSurface } = useCardExport();

  const [post, setPost] = useState<FeedPost | null>(null);
  const [stats, setStats] = useState<PostStats | undefined>(undefined);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");

  useEffect(() => {
    let cancelled = false;

    // Wait for auth to settle first: querying as an anonymous visitor and then
    // again as the signed-in member would show "not available" for a moment on
    // every whisper post the viewer is in fact allowed to read.
    if (authLoading) return;

    (async () => {
      setState("loading");
      const { data, error } = await supabase
        .from("posts")
        .select(POST_SELECT)
        .eq("id", id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        setState("error");
        return;
      }
      if (!data) {
        // Deleted, or outside this viewer's audience. Both are "you cannot see
        // this", and distinguishing them would leak the existence of the post.
        setState("missing");
        return;
      }

      const row = data as unknown as FeedPost;
      setPost(row);
      setState("ready");

      const map = await fetchPostStats([row.id], user?.id);
      if (!cancelled) setStats(map.get(row.id));
    })();

    return () => {
      cancelled = true;
    };
  }, [id, user?.id, authLoading]);

  return (
    <div className="min-h-screen">
      <AppHeader />

      <main className="page-enter mx-auto max-w-xl px-4 pb-mobile-nav pt-5 sm:px-6">
        <button
          type="button"
          /* history.back() when there is somewhere to go back to, so tapping back
             after arriving from the feed returns you to your scroll position.
             A shared link opens in a fresh tab with no history, and there the
             button has to go somewhere real instead of doing nothing. */
          onClick={() => {
            if (window.history.length > 1) window.history.back();
            else navigate({ to: "/feed" });
          }}
          className="mb-4 inline-flex items-center gap-2 text-[13px] text-secondary transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        {state === "loading" ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading post…
          </div>
        ) : state === "error" ? (
          <div
            className="rounded-xl border p-6 text-center"
            style={{ borderColor: "var(--border)" }}
          >
            <p className="text-[14px] font-medium">Couldn&apos;t load this post.</p>
            <p className="mt-1 text-[13px] text-secondary">Check your connection and try again.</p>
          </div>
        ) : state === "missing" ? (
          <div
            className="flex flex-col items-center rounded-xl border px-6 py-12 text-center"
            style={{ borderColor: "var(--border)" }}
          >
            <div
              className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl"
              style={{ background: "rgba(255,255,255,0.06)" }}
            >
              <EyeOff className="h-5 w-5 text-muted-foreground" strokeWidth={1.8} />
            </div>
            <p className="text-[15px] font-semibold tracking-tight">Post not available</p>
            <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-secondary">
              It may have been deleted, or the author limited who can see it.
              {!user ? " Signing in may give you access." : ""}
            </p>
            {!user ? (
              <Link to="/" className="btn btn-primary btn-sm mt-5">
                Sign in
              </Link>
            ) : (
              <Link to="/feed" className="btn btn-primary btn-sm mt-5">
                Go to the feed
              </Link>
            )}
          </div>
        ) : post ? (
          <PostCard
            post={post}
            currentUserId={user?.id}
            onDownload={requestExport}
            stats={stats}
            onDeleted={() => navigate({ to: "/feed" })}
            onEdited={(_id, content, editedAt) =>
              setPost((prev) => (prev ? { ...prev, content, edited_at: editedAt } : prev))
            }
          />
        ) : null}
      </main>

      {exportSurface}
    </div>
  );
}

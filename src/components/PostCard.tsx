import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Heart,
  MessageCircle,
  Repeat2,
  Download,
  Flag,
  MessageSquare,
  Loader2,
  Send,
  Trash2,
  Lock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatusCard, type Background } from "@/components/StatusCard";
import { VerificationBadge } from "@/components/VerificationBadge";
import { useAuth } from "@/hooks/use-auth";
import { timeAgo } from "@/lib/time";
import { startConversation } from "@/lib/messaging.functions";
import type { VerificationTier } from "@/hooks/use-auth";

export type FeedAuthor = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  verification_tier: VerificationTier;
};

export type FeedPost = {
  id: string;
  content: string;
  background: Background;
  comments_enabled: boolean;
  visibility: string;
  created_at: string;
  author: FeedAuthor;
};

type CommentRow = {
  id: string;
  content: string;
  created_at: string;
  author: FeedAuthor;
};

export function PostCard({
  post,
  onDownload,
  currentUserId,
  onDeleted,
}: {
  post: FeedPost;
  onDownload: (post: FeedPost) => void;
  currentUserId?: string;
  onDeleted?: (id: string) => void;
}) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const start = useServerFn(startConversation);

  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [reposted, setReposted] = useState(false);
  const [repostCount, setRepostCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [busyLike, setBusyLike] = useState(false);
  const [busyRepost, setBusyRepost] = useState(false);
  const [busyMsg, setBusyMsg] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);
  const [reported, setReported] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [threadOpen, setThreadOpen] = useState(false);
  const [comments, setComments] = useState<CommentRow[] | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  const isSelf = (user?.id ?? currentUserId) === post.author.id;
  const commentsEnabled = post.comments_enabled !== false; // treat undefined as true
  const isVerifiedOnly = post.visibility === "verified_only";
  const isWhisper = post.visibility === "whisper";

  // Tier-based border + glow styles
  const tierBorder =
    post.author.verification_tier === "gold"
      ? "border-amber-500/25 glow-gold"
      : post.author.verification_tier === "silver"
        ? "border-slate-400/25 glow-silver"
        : "border-border/50";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const uid = user?.id;
      const [likesRes, myLikeRes, repostsRes, myRepostRes, commentsRes] = await Promise.all([
        supabase.from("likes").select("*", { count: "exact", head: true }).eq("post_id", post.id),
        uid
          ? supabase.from("likes").select("post_id").eq("post_id", post.id).eq("user_id", uid).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from("reposts").select("*", { count: "exact", head: true }).eq("post_id", post.id),
        uid
          ? supabase.from("reposts").select("post_id").eq("post_id", post.id).eq("user_id", uid).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from("comments").select("*", { count: "exact", head: true }).eq("post_id", post.id),
      ]);
      if (cancelled) return;
      setLikeCount(likesRes.count ?? 0);
      setLiked(!!(myLikeRes as { data: unknown }).data);
      setRepostCount(repostsRes.count ?? 0);
      setReposted(!!(myRepostRes as { data: unknown }).data);
      setCommentCount(commentsRes.count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [post.id, user]);

  async function toggleLike() {
    if (!user) { toast.error("Sign in to like posts."); return; }
    setBusyLike(true);
    if (liked) {
      const { error } = await supabase.from("likes").delete().eq("post_id", post.id).eq("user_id", user.id);
      if (!error) { setLiked(false); setLikeCount((c) => Math.max(0, c - 1)); }
    } else {
      const { error } = await supabase.from("likes").insert({ post_id: post.id, user_id: user.id });
      if (!error) { setLiked(true); setLikeCount((c) => c + 1); }
    }
    setBusyLike(false);
  }

  async function toggleRepost() {
    if (!user) { toast.error("Sign in to re-ship."); return; }
    setBusyRepost(true);
    if (reposted) {
      const { error } = await supabase.from("reposts").delete().eq("post_id", post.id).eq("user_id", user.id);
      if (!error) { setReposted(false); setRepostCount((c) => Math.max(0, c - 1)); }
    } else {
      const { error } = await supabase.from("reposts").insert({ post_id: post.id, user_id: user.id });
      if (!error) { setReposted(true); setRepostCount((c) => c + 1); toast.success("Re-shipped."); }
    }
    setBusyRepost(false);
  }

  async function loadComments() {
    const { data, error } = await supabase
      .from("comments")
      .select("id, content, created_at, author:profiles!comments_author_id_fkey(id, handle, display_name, avatar_url, verification_tier)")
      .eq("post_id", post.id)
      .order("created_at", { ascending: true });
    if (!error) setComments((data ?? []) as unknown as CommentRow[]);
  }

  async function toggleThread() {
    const next = !threadOpen;
    setThreadOpen(next);
    if (next && comments === null) await loadComments();
  }

  async function submitComment() {
    if (!user || !profile) { toast.error("Sign in to comment."); return; }
    const body = commentDraft.trim();
    if (!body) return;
    setPostingComment(true);
    const { error } = await supabase.from("comments").insert({
      post_id: post.id,
      author_id: user.id,
      content: body,
    });
    setPostingComment(false);
    if (error) { toast.error(error.message); return; }
    setCommentDraft("");
    setCommentCount((c) => c + 1);
    await loadComments();
  }

  async function message() {
    if (!user || !profile) { toast.error("Sign in to send a message."); return; }
    setBusyMsg(true);
    try {
      const res = await start({ data: { recipientId: post.author.id } });
      navigate({ to: "/messages/$id", params: { id: res.conversationId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start a conversation.");
    } finally {
      setBusyMsg(false);
    }
  }

  async function report() {
    if (!user) { toast.error("Sign in to report posts."); return; }
    const { error } = await supabase.from("reports").insert({ post_id: post.id, reporter_id: user.id });
    if (error && !error.message.includes("duplicate")) { toast.error("Couldn't submit report."); return; }
    setReported(true);
    toast.success("Thanks — the moderators will review.");
  }

  async function deletePost() {
    if (!user || !isSelf) return;
    setBusyDelete(true);
    const { error } = await supabase.from("posts").delete().eq("id", post.id).eq("author_id", user.id);
    setBusyDelete(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Post deleted.");
    onDeleted?.(post.id);
  }

  const actionBtn = "inline-flex items-center gap-1.5 text-xs transition-colors disabled:opacity-40 select-none";

  return (
    <article className={`rounded-2xl border bg-card/40 p-4 sm:p-5 ${tierBorder}`}>
      {/* ── Visibility badges ── */}
      {(isVerifiedOnly || isWhisper) && (
        <div className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" />
          {isWhisper ? (
            <span className="font-medium text-violet-400/80">Whisper Feed</span>
          ) : (
            <span>Verified only</span>
          )}
        </div>
      )}

      <div className="flex items-start gap-3">
        {/* Avatar */}
        <Link to="/u/$handle" params={{ handle: post.author.handle }} className="shrink-0">
          <div className="grid h-10 w-10 overflow-hidden rounded-full border border-border bg-secondary/50 text-sm font-semibold">
            {post.author.avatar_url ? (
              <img
                src={post.author.avatar_url}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="grid h-full w-full place-items-center">
                {post.author.display_name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
        </Link>

        <div className="min-w-0 flex-1">
          {/* Meta row */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
              <Link
                to="/u/$handle"
                params={{ handle: post.author.handle }}
                className="flex items-center gap-1 font-semibold text-foreground hover:underline underline-offset-2"
              >
                {post.author.display_name}
                <VerificationBadge tier={post.author.verification_tier} size={14} />
              </Link>
              <span className="text-muted-foreground">@{post.author.handle}</span>
              <span className="text-muted-foreground">· {timeAgo(post.created_at)}</span>
            </div>
            {/* Delete own post */}
            {isSelf && onDeleted && (
              <div className="shrink-0">
                {confirmDelete ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Delete?</span>
                    <button
                      type="button"
                      onClick={deletePost}
                      disabled={busyDelete}
                      className="text-xs text-red-400 transition-colors hover:text-red-300"
                    >
                      {busyDelete ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Yes"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="rounded p-1 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                    aria-label="Delete post"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Content */}
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground">
            {post.content}
          </p>

          {/* Actions row */}
          <div className="mt-3 flex items-center gap-5 text-muted-foreground">
            <button
              type="button"
              onClick={toggleLike}
              disabled={busyLike}
              className={actionBtn + (liked ? " text-rose-400" : " hover:text-foreground")}
              aria-label="Like"
            >
              <Heart className="h-4 w-4" fill={liked ? "currentColor" : "none"} />
              {likeCount > 0 ? likeCount : ""}
            </button>

            {commentsEnabled && (
              <button
                type="button"
                onClick={toggleThread}
                className={actionBtn + " hover:text-foreground"}
                aria-label="Comment"
              >
                <MessageCircle className="h-4 w-4" />
                {commentCount > 0 ? commentCount : ""}
              </button>
            )}

            <button
              type="button"
              onClick={toggleRepost}
              disabled={busyRepost || isSelf}
              className={actionBtn + (reposted ? " text-emerald-400" : " hover:text-foreground")}
              aria-label="Re-Ship"
            >
              <Repeat2 className="h-4 w-4" />
              {repostCount > 0 ? repostCount : ""}
            </button>

            <button
              type="button"
              onClick={() => onDownload(post)}
              className={actionBtn + " hover:text-foreground"}
              aria-label="Download status card"
            >
              <Download className="h-4 w-4" />
            </button>

            {user && !isSelf ? (
              <button
                type="button"
                onClick={message}
                disabled={busyMsg}
                className={actionBtn + " hover:text-foreground"}
                aria-label="Message author"
              >
                {busyMsg ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
              </button>
            ) : null}

            <button
              type="button"
              onClick={report}
              disabled={reported}
              className={actionBtn + " ml-auto hover:text-foreground"}
              aria-label="Report post"
            >
              <Flag className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Comments section */}
          {!commentsEnabled ? (
            threadOpen && (
              <div className="mt-4 border-t border-border/50 pt-3">
                <p className="text-xs text-muted-foreground">Comments have been disabled for this post.</p>
              </div>
            )
          ) : threadOpen ? (
            <div className="mt-4 space-y-3 border-t border-border/50 pt-3">
              {comments === null ? (
                <p className="text-xs text-muted-foreground">Loading comments…</p>
              ) : comments.length === 0 ? (
                <p className="text-xs text-muted-foreground">No replies yet.</p>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-2.5 pl-2">
                    <div className="grid h-7 w-7 shrink-0 overflow-hidden rounded-full border border-border bg-secondary/50 text-xs font-semibold">
                      {c.author.avatar_url ? (
                        <img
                          src={c.author.avatar_url}
                          alt=""
                          className="h-full w-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="grid h-full w-full place-items-center">
                          {c.author.display_name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1 text-xs">
                        <Link
                          to="/u/$handle"
                          params={{ handle: c.author.handle }}
                          className="flex items-center gap-1 font-medium text-foreground hover:underline underline-offset-2"
                        >
                          {c.author.display_name}
                          <VerificationBadge tier={c.author.verification_tier} size={11} />
                        </Link>
                        <span className="text-muted-foreground">@{c.author.handle}</span>
                        <span className="text-muted-foreground">· {timeAgo(c.created_at)}</span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground/90">
                        {c.content}
                      </p>
                    </div>
                  </div>
                ))
              )}

              {user ? (
                <div className="flex items-center gap-2 pl-2 pt-1">
                  <input
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitComment(); }}
                    maxLength={280}
                    placeholder="Reply…"
                    className="flex-1 rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-sm outline-none focus:border-foreground/40"
                  />
                  <button
                    type="button"
                    onClick={submitComment}
                    disabled={postingComment || !commentDraft.trim()}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    aria-label="Send reply"
                  >
                    {postingComment ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

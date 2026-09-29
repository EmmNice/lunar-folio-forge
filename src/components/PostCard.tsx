import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Heart,
  MessageCircle,
  Repeat2,
  Download,
  Flag,
  Loader2,
  Send,
  Trash2,
  Lock,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { THEMES, type Background } from "@/components/StatusCard";
import { VerificationBadge } from "@/components/VerificationBadge";
import { useAuth } from "@/hooks/use-auth";
import { timeAgo } from "@/lib/time";
import { removePost } from "@/lib/admin.functions";
import { MAX_POST_LENGTH, MAX_REPORT_REASON_LENGTH } from "@/lib/limits";
import { describeWriteError } from "@/lib/db-errors";
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

/**
 * Like/repost/comment counts for one post, gathered in bulk by the parent.
 *
 * Each card used to issue five count queries of its own on mount. With the feed
 * pulling 200 posts that was up to a thousand HTTP requests for a single screen —
 * enough to get rate-limited and slow enough to look broken. The feed now fetches
 * all five figures for the whole page in three queries and passes them down.
 * `stats` is optional so a card rendered on its own still works.
 */
export type PostStats = {
  likes: number;
  reposts: number;
  comments: number;
  likedByMe: boolean;
  repostedByMe: boolean;
};

export function PostCard({
  post,
  onDownload,
  currentUserId,
  onDeleted,
  stats,
}: {
  post: FeedPost;
  onDownload: (post: FeedPost) => void;
  currentUserId?: string;
  onDeleted?: (id: string) => void;
  stats?: PostStats;
}) {
  const { user, profile, isAdmin } = useAuth();

  const [liked, setLiked] = useState(stats?.likedByMe ?? false);
  const [likeCount, setLikeCount] = useState(stats?.likes ?? 0);
  const [reposted, setReposted] = useState(stats?.repostedByMe ?? false);
  const [repostCount, setRepostCount] = useState(stats?.reposts ?? 0);
  const [commentCount, setCommentCount] = useState(stats?.comments ?? 0);
  const [busyLike, setBusyLike] = useState(false);
  const [busyRepost, setBusyRepost] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);
  const [reported, setReported] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [busyReport, setBusyReport] = useState(false);
  const [deletingComment, setDeletingComment] = useState<string | null>(null);

  const [threadOpen, setThreadOpen] = useState(false);
  const [comments, setComments] = useState<CommentRow[] | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  const removePostFn = useServerFn(removePost);

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

  // When the parent supplied stats, adopt them and issue no queries at all.
  useEffect(() => {
    if (!stats) return;
    setLikeCount(stats.likes);
    setRepostCount(stats.reposts);
    setCommentCount(stats.comments);
    setLiked(stats.likedByMe);
    setReposted(stats.repostedByMe);
  }, [stats]);

  // Standalone fallback for cards rendered outside a list that batches counts.
  useEffect(() => {
    if (stats) return;
    let cancelled = false;
    (async () => {
      const uid = user?.id;
      const [likesRes, myLikeRes, repostsRes, myRepostRes, commentsRes] = await Promise.all([
        supabase.from("likes").select("*", { count: "exact", head: true }).eq("post_id", post.id),
        uid
          ? supabase
              .from("likes")
              .select("post_id")
              .eq("post_id", post.id)
              .eq("user_id", uid)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from("reposts").select("*", { count: "exact", head: true }).eq("post_id", post.id),
        uid
          ? supabase
              .from("reposts")
              .select("post_id")
              .eq("post_id", post.id)
              .eq("user_id", uid)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from("comments")
          .select("*", { count: "exact", head: true })
          .eq("post_id", post.id),
      ]);
      if (cancelled) return;
      setLikeCount(likesRes.count ?? 0);
      setLiked(!!(myLikeRes as { data: unknown }).data);
      setRepostCount(repostsRes.count ?? 0);
      setReposted(!!(myRepostRes as { data: unknown }).data);
      setCommentCount(commentsRes.count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [post.id, user, stats]);

  async function toggleLike() {
    if (!user) {
      toast.error("Sign in to like posts.");
      return;
    }
    setBusyLike(true);
    // Both branches used to discard `error` entirely, so an RLS denial or a
    // dropped connection left the heart exactly as it was with no explanation —
    // the button simply looked broken.
    if (liked) {
      const { error } = await supabase
        .from("likes")
        .delete()
        .eq("post_id", post.id)
        .eq("user_id", user.id);
      if (error) {
        toast.error(describeWriteError(error.message, "unlike this post"));
      } else {
        setLiked(false);
        setLikeCount((c) => Math.max(0, c - 1));
      }
    } else {
      const { error } = await supabase.from("likes").insert({ post_id: post.id, user_id: user.id });
      if (error) {
        toast.error(describeWriteError(error.message, "like posts"));
      } else {
        setLiked(true);
        setLikeCount((c) => c + 1);
      }
    }
    setBusyLike(false);
  }

  async function toggleRepost() {
    if (!user) {
      toast.error("Sign in to re-ship.");
      return;
    }
    setBusyRepost(true);
    if (reposted) {
      const { error } = await supabase
        .from("reposts")
        .delete()
        .eq("post_id", post.id)
        .eq("user_id", user.id);
      if (error) {
        toast.error(describeWriteError(error.message, "undo this re-ship"));
      } else {
        setReposted(false);
        setRepostCount((c) => Math.max(0, c - 1));
      }
    } else {
      const { error } = await supabase
        .from("reposts")
        .insert({ post_id: post.id, user_id: user.id });
      if (error) {
        toast.error(describeWriteError(error.message, "re-ship posts"));
      } else {
        setReposted(true);
        setRepostCount((c) => c + 1);
        toast.success("Re-shipped.");
      }
    }
    setBusyRepost(false);
  }

  async function loadComments() {
    const { data, error } = await supabase
      .from("comments")
      .select(
        "id, content, created_at, author:profiles!comments_author_id_fkey(id, handle, display_name, avatar_url, verification_tier)",
      )
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
    if (!user || !profile) {
      toast.error("Sign in to comment.");
      return;
    }
    const body = commentDraft.trim();
    if (!body) return;
    setPostingComment(true);
    const { error } = await supabase.from("comments").insert({
      post_id: post.id,
      author_id: user.id,
      content: body,
    });
    setPostingComment(false);
    if (error) {
      toast.error(describeWriteError(error.message, "reply to this post"));
      return;
    }
    setCommentDraft("");
    setCommentCount((c) => c + 1);
    await loadComments();
  }

  /**
   * File a report.
   *
   * The reason is now captured. The column existed from the start but no UI ever
   * filled it, so every report reaching a moderator said only "someone objected
   * to this" — which is close to unactionable. Reports are also now visible to
   * admins in the panel, so the "moderators will review" toast is true.
   */
  async function submitReport() {
    if (!user) {
      toast.error("Sign in to report posts.");
      return;
    }
    const reason = reportReason.trim();
    if (!reason) {
      toast.error("Add a short reason so a moderator knows what to look at.");
      return;
    }
    setBusyReport(true);
    const { error } = await supabase
      .from("reports")
      .insert({ post_id: post.id, reporter_id: user.id, reason: reason.slice(0, 500) });
    setBusyReport(false);
    if (error && !error.message.toLowerCase().includes("duplicate")) {
      toast.error("Couldn't submit report.");
      return;
    }
    setReported(true);
    setReportOpen(false);
    setReportReason("");
    toast.success("Reported. A moderator will review it.");
  }

  async function deletePost() {
    if (!user) return;

    // Admins delete through a server function so the removal is authorised
    // server-side and lands in the audit log; authors delete their own directly.
    if (!isSelf) {
      if (!isAdmin) return;
      setBusyDelete(true);
      try {
        await removePostFn({ data: { postId: post.id, reason: "Removed from feed by moderator" } });
        toast.success("Post removed.");
        onDeleted?.(post.id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't remove the post.");
      } finally {
        setBusyDelete(false);
      }
      return;
    }

    setBusyDelete(true);
    const { error } = await supabase
      .from("posts")
      .delete()
      .eq("id", post.id)
      .eq("author_id", user.id);
    setBusyDelete(false);
    if (error) {
      toast.error(describeWriteError(error.message, "do that"));
      return;
    }
    toast.success("Post deleted.");
    onDeleted?.(post.id);
  }

  /** Remove one of your own comments. The RLS policy always allowed it; no UI did. */
  async function deleteComment(commentId: string) {
    if (!user) return;
    setDeletingComment(commentId);
    const { error } = await supabase
      .from("comments")
      .delete()
      .eq("id", commentId)
      .eq("author_id", user.id);
    setDeletingComment(null);
    if (error) {
      toast.error(describeWriteError(error.message, "do that"));
      return;
    }
    setComments((prev) => prev?.filter((c) => c.id !== commentId) ?? null);
    setCommentCount((c) => Math.max(0, c - 1));
  }

  const actionBtn =
    "inline-flex items-center gap-1.5 text-xs transition-colors disabled:opacity-40 select-none";

  // Studio card posts (non-noir theme) get an entirely different visual treatment
  const isCardPost = post.background !== "noir";

  /* Shared delete toggle — the author's own post, or an admin removing any post */
  const canDelete = (isSelf || isAdmin) && !!onDeleted;
  const deleteControl = canDelete ? (
    <div className="shrink-0">
      {confirmDelete ? (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            {isSelf ? "Delete?" : "Remove as moderator?"}
          </span>
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
          aria-label={isSelf ? "Delete post" : "Remove post as moderator"}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  ) : null;

  /* Shared actions row */
  const actionsRow = (
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
        aria-label="Save card as an image"
      >
        <Download className="h-4 w-4" />
      </button>

      {!isSelf && (
        <button
          type="button"
          onClick={() => setReportOpen((v) => !v)}
          disabled={reported}
          className={actionBtn + (reported ? " ml-auto" : " ml-auto hover:text-foreground")}
          aria-label={reported ? "Already reported" : "Report post"}
          title={reported ? "You've reported this post" : "Report post"}
        >
          <Flag className="h-3.5 w-3.5" fill={reported ? "currentColor" : "none"} />
        </button>
      )}
    </div>
  );

  /* Report form — opens under the actions row so a reason can be captured */
  const reportForm =
    reportOpen && !reported ? (
      <div className="mt-3 rounded-xl border border-border/60 bg-secondary/20 p-3">
        <label className="text-xs font-medium text-foreground" htmlFor={`report-${post.id}`}>
          Why are you reporting this?
        </label>
        <textarea
          id={`report-${post.id}`}
          value={reportReason}
          onChange={(e) => setReportReason(e.target.value)}
          maxLength={MAX_REPORT_REASON_LENGTH}
          rows={2}
          placeholder="Spam, harassment, impersonation, off-platform scam…"
          className="mt-2 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setReportOpen(false);
              setReportReason("");
            }}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submitReport}
            disabled={busyReport || !reportReason.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busyReport && <Loader2 className="h-3 w-3 animate-spin" />}
            Submit report
          </button>
        </div>
      </div>
    ) : null;

  /* Shared comments thread */
  const commentsThread = (
    <>
      {!commentsEnabled ? (
        threadOpen && (
          <div className="mt-4 border-t border-border/50 pt-3">
            <p className="text-xs text-muted-foreground">
              Comments have been disabled for this post.
            </p>
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
                      crossOrigin="anonymous"
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
                      search={{ tab: undefined }}
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
                {c.author.id === user?.id && (
                  <button
                    type="button"
                    onClick={() => deleteComment(c.id)}
                    disabled={deletingComment === c.id}
                    className="shrink-0 rounded p-1 text-muted-foreground/40 transition-colors hover:text-red-400 disabled:opacity-40"
                    aria-label="Delete your reply"
                  >
                    {deletingComment === c.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </button>
                )}
              </div>
            ))
          )}

          {user ? (
            <div className="flex w-full items-center gap-2 px-2 pt-1">
              <input
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Shift+Enter has to stay free for a line break, which the old
                  // unconditional handler made impossible.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitComment();
                  }
                }}
                maxLength={MAX_POST_LENGTH}
                placeholder="Reply…"
                className="min-w-0 flex-1 rounded-full border border-border bg-secondary/40 px-4 py-2 text-sm outline-none focus:border-foreground/40"
              />
              <button
                type="button"
                onClick={submitComment}
                disabled={postingComment || !commentDraft.trim()}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:opacity-50"
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
    </>
  );

  /* Beat post (Studio-crafted, non-noir theme) */
  if (isCardPost) {
    const theme = THEMES[post.background ?? "cream"] ?? THEMES.cream;
    const dotPattern = `radial-gradient(${theme.dot} 1px, transparent 1px)`;

    return (
      <article className={`rounded-2xl border bg-card/50 overflow-hidden ${tierBorder}`}>
        {/* Author header — same layout as regular posts */}
        <div className="flex items-start gap-3 px-4 pt-4 pb-0 sm:px-5">
          {/* Avatar */}
          <Link
            to="/u/$handle"
            params={{ handle: post.author.handle }}
            search={{ tab: undefined }}
            className="shrink-0 self-start"
          >
            <div
              className={`grid h-11 w-11 overflow-hidden rounded-full bg-secondary/60 text-sm font-semibold transition-opacity hover:opacity-85 ${
                post.author.verification_tier === "gold"
                  ? "ring-2 ring-amber-400/70 ring-offset-1 ring-offset-background"
                  : post.author.verification_tier === "silver"
                    ? "ring-2 ring-slate-400/60 ring-offset-1 ring-offset-background"
                    : "ring-1 ring-border/60"
              }`}
            >
              {post.author.avatar_url ? (
                <img
                  src={post.author.avatar_url}
                  alt=""
                  className="h-full w-full object-cover"
                  crossOrigin="anonymous"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="grid h-full w-full place-items-center text-[15px] font-bold text-foreground/70">
                  {post.author.display_name.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
          </Link>

          {/* Name / handle / time */}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {(isVerifiedOnly || isWhisper) && (
                  <span
                    className="mb-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      background: isWhisper ? "rgba(167,139,250,0.10)" : "rgba(255,255,255,0.06)",
                      color: isWhisper ? "#c4b5fd" : "#94a3b8",
                      border: `1px solid ${isWhisper ? "rgba(167,139,250,0.20)" : "rgba(255,255,255,0.08)"}`,
                    }}
                  >
                    <Lock className="h-2.5 w-2.5" />
                    {isWhisper ? "Whisper Feed" : "Verified only"}
                  </span>
                )}
                <Link
                  to="/u/$handle"
                  params={{ handle: post.author.handle }}
                  search={{ tab: undefined }}
                  className="inline-flex items-center gap-1.5 font-semibold leading-tight text-foreground hover:underline underline-offset-2"
                >
                  {post.author.display_name}
                  <VerificationBadge tier={post.author.verification_tier} size={15} />
                </Link>
                <p className="mt-0.5 text-[12px] text-muted-foreground/70">
                  @{post.author.handle}
                  <span className="mx-1.5 opacity-50">·</span>
                  {timeAgo(post.created_at)}
                </p>
              </div>
              {deleteControl}
            </div>
          </div>
        </div>

        {/* Themed content block */}
        <div className="px-4 pt-3 pb-1 sm:px-5">
          <div
            className="rounded-xl px-4 py-4"
            style={{
              backgroundColor: theme.bg,
              backgroundImage: dotPattern,
              backgroundSize: "18px 18px",
              border: `1px solid ${theme.border}`,
            }}
          >
            <p
              className="whitespace-pre-wrap break-words text-[15px] font-medium leading-[1.6] tracking-[-0.01em]"
              style={{ color: theme.body }}
            >
              {post.content}
            </p>
          </div>
        </div>

        {/* Actions + comments */}
        <div className="px-4 pb-3 sm:px-5">
          {actionsRow}
          {reportForm}
          {commentsThread}
        </div>
      </article>
    );
  }

  /* Regular text post — polished layout */
  const avatarRing =
    post.author.verification_tier === "gold"
      ? "ring-2 ring-amber-400/70 ring-offset-1 ring-offset-background"
      : post.author.verification_tier === "silver"
        ? "ring-2 ring-slate-400/60 ring-offset-1 ring-offset-background"
        : "ring-1 ring-border/60";

  return (
    <article
      className={`group relative rounded-2xl border bg-card/50 transition-colors hover:bg-card/70 ${tierBorder}`}
    >
      {/* Gold accent top bar */}
      {post.author.verification_tier === "gold" && (
        <div
          className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl"
          style={{
            background: "linear-gradient(90deg, transparent, rgba(251,191,36,0.5), transparent)",
          }}
        />
      )}

      <div className="px-4 pt-4 pb-3 sm:px-5 sm:pt-5">
        {/* Visibility pill */}
        {(isVerifiedOnly || isWhisper) && (
          <div className="mb-3 flex items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{
                background: isWhisper ? "rgba(167,139,250,0.10)" : "rgba(255,255,255,0.06)",
                color: isWhisper ? "#c4b5fd" : "#94a3b8",
                border: `1px solid ${isWhisper ? "rgba(167,139,250,0.20)" : "rgba(255,255,255,0.08)"}`,
              }}
            >
              <Lock className="h-2.5 w-2.5" />
              {isWhisper ? "Whisper Feed" : "Verified only"}
            </span>
          </div>
        )}

        <div className="flex gap-3.5">
          {/* Avatar with tier ring */}
          <Link
            to="/u/$handle"
            params={{ handle: post.author.handle }}
            search={{ tab: undefined }}
            className="shrink-0 self-start"
          >
            <div
              className={`grid h-11 w-11 overflow-hidden rounded-full bg-secondary/60 text-sm font-semibold transition-opacity hover:opacity-85 ${avatarRing}`}
            >
              {post.author.avatar_url ? (
                <img
                  src={post.author.avatar_url}
                  alt=""
                  className="h-full w-full object-cover"
                  crossOrigin="anonymous"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="grid h-full w-full place-items-center text-[15px] font-bold text-foreground/70">
                  {post.author.display_name.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
          </Link>

          <div className="min-w-0 flex-1">
            {/* Meta: name on top, handle + time below */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link
                  to="/u/$handle"
                  params={{ handle: post.author.handle }}
                  search={{ tab: undefined }}
                  className="inline-flex items-center gap-1.5 font-semibold leading-tight text-foreground hover:underline underline-offset-2"
                >
                  {post.author.display_name}
                  <VerificationBadge tier={post.author.verification_tier} size={15} />
                </Link>
                <p className="mt-0.5 text-[12px] text-muted-foreground/70">
                  @{post.author.handle}
                  <span className="mx-1.5 opacity-50">·</span>
                  {timeAgo(post.created_at)}
                </p>
              </div>
              {deleteControl}
            </div>

            {/* Content */}
            <p className="mt-2.5 whitespace-pre-wrap break-words text-[15px] leading-[1.65] text-foreground/95 tracking-[-0.01em]">
              {post.content}
            </p>

            {actionsRow}
            {reportForm}
            {commentsThread}
          </div>
        </div>
      </div>
    </article>
  );
}

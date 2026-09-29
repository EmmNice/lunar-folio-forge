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
  Pencil,
  CornerDownRight,
  Bookmark,
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
import { RichText } from "@/components/RichText";
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
  /** Stamped by the posts_touch_edited trigger. Null means never edited. */
  edited_at?: string | null;
  author: FeedAuthor;
};

/** Who re-shipped this into the viewer's feed, when the card is a repost. */
export type RepostAttribution = {
  handle: string;
  display_name: string;
};

type CommentRow = {
  id: string;
  content: string;
  created_at: string;
  parent_id: string | null;
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
  /**
   * Whether the viewer has saved this post.
   *
   * Batched with the rest rather than fetched per card. Adding bookmarks as a
   * per-card query reintroduced exactly the N+1 this type exists to prevent —
   * measured as one `bookmarks` request per rendered post on the live feed.
   */
  bookmarkedByMe: boolean;
};

export function PostCard({
  post,
  onDownload,
  currentUserId,
  onDeleted,
  onEdited,
  repostedBy,
  stats,
}: {
  post: FeedPost;
  onDownload: (post: FeedPost) => void;
  currentUserId?: string;
  onDeleted?: (id: string) => void;
  /** Lets the parent list update its copy after an in-place edit. */
  onEdited?: (id: string, content: string, editedAt: string | null) => void;
  repostedBy?: RepostAttribution;
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
  /** Top-level comment this reply will hang under, or null for a new thread. */
  const [replyParent, setReplyParent] = useState<CommentRow | null>(null);

  const [bookmarked, setBookmarked] = useState(false);
  const [busyBookmark, setBusyBookmark] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(post.content);
  const [savingEdit, setSavingEdit] = useState(false);
  const [content, setContent] = useState(post.content);
  const [editedAt, setEditedAt] = useState<string | null>(post.edited_at ?? null);

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

  // Keep the local copy in step when the parent hands down a changed row —
  // a realtime update, or the same post re-rendered in a different list.
  useEffect(() => {
    setContent(post.content);
    setEditedAt(post.edited_at ?? null);
    setEditDraft(post.content);
  }, [post.content, post.edited_at]);

  /*
    Whether *this* member has saved the post.

    Not part of PostStats: bookmarks are private, so unlike likes and reposts there
    is no shared count to batch — only the viewer's own row, which nobody else can
    read. One indexed primary-key lookup per card, and none at all when signed out.
  */
  useEffect(() => {
    // The parent batched it; one request for the whole page already covered this.
    if (stats) return;
    const uid = user?.id;
    if (!uid) {
      setBookmarked(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("bookmarks")
        .select("post_id")
        .eq("user_id", uid)
        .eq("post_id", post.id)
        .maybeSingle();
      if (!cancelled) setBookmarked(Boolean(data));
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, post.id, stats]);

  async function toggleBookmark() {
    if (!user) {
      toast.error("Sign in to save posts.");
      return;
    }
    setBusyBookmark(true);
    if (bookmarked) {
      const { error } = await supabase
        .from("bookmarks")
        .delete()
        .eq("user_id", user.id)
        .eq("post_id", post.id);
      setBusyBookmark(false);
      if (error) {
        toast.error(describeWriteError(error.message, "remove this save"));
        return;
      }
      setBookmarked(false);
    } else {
      const { error } = await supabase
        .from("bookmarks")
        .insert({ user_id: user.id, post_id: post.id });
      setBusyBookmark(false);
      if (error) {
        toast.error(describeWriteError(error.message, "save posts"));
        return;
      }
      setBookmarked(true);
      toast.success("Saved.");
    }
  }

  // When the parent supplied stats, adopt them and issue no queries at all.
  useEffect(() => {
    if (!stats) return;
    setLikeCount(stats.likes);
    setRepostCount(stats.reposts);
    setCommentCount(stats.comments);
    setLiked(stats.likedByMe);
    setReposted(stats.repostedByMe);
    setBookmarked(stats.bookmarkedByMe);
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
        "id, content, created_at, parent_id, author:profiles!comments_author_id_fkey(id, handle, display_name, avatar_url, verification_tier)",
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

  /**
   * Post a reply, optionally under another comment.
   *
   * The database caps nesting at two levels (guard_comment_depth). Rather than let
   * a third-level attempt come back as a constraint violation, replying to a reply
   * attaches to that reply's *parent* and addresses the person by handle — the
   * conversation stays readable on a phone and the member never meets an error
   * they could not have predicted.
   */
  async function submitComment() {
    if (!user || !profile) {
      toast.error("Sign in to comment.");
      return;
    }
    const body = commentDraft.trim();
    if (!body) return;

    const parentId = replyParent ? (replyParent.parent_id ?? replyParent.id) : null;

    setPostingComment(true);
    const { error } = await supabase.from("comments").insert({
      post_id: post.id,
      author_id: user.id,
      content: body,
      parent_id: parentId,
    });
    setPostingComment(false);
    if (error) {
      toast.error(describeWriteError(error.message, "reply to this post"));
      return;
    }
    setCommentDraft("");
    setReplyParent(null);
    setCommentCount((c) => c + 1);
    await loadComments();
  }

  /**
   * Save an edit to your own post.
   *
   * Only `content` is sent. `edited_at` is stamped by the posts_touch_edited
   * trigger rather than written here, so the "edited" mark cannot be avoided by
   * PATCHing the row directly — and the value is read back rather than guessed at,
   * since the database clock is the one that decides.
   */
  async function savePostEdit() {
    if (!user) return;
    const next = editDraft.trim();
    if (!next) {
      toast.error("A post can't be empty.");
      return;
    }
    if (next === content) {
      setEditing(false);
      return;
    }

    setSavingEdit(true);
    const { data, error } = await supabase
      .from("posts")
      .update({ content: next })
      .eq("id", post.id)
      .eq("author_id", user.id)
      .select("id, content, edited_at")
      .maybeSingle();
    setSavingEdit(false);

    if (error) {
      toast.error(describeWriteError(error.message, "edit this post"));
      return;
    }
    if (!data) {
      toast.error("That post is no longer yours to edit.");
      return;
    }

    setContent(data.content);
    setEditedAt(data.edited_at);
    setEditing(false);
    onEdited?.(post.id, data.content, data.edited_at);
    toast.success("Post updated.");
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
    "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 -mx-0.5 text-[13px] font-medium tabular-nums " +
    "transition-colors disabled:opacity-40 select-none";

  // Studio card posts (non-noir theme) get an entirely different visual treatment
  const isCardPost = post.background !== "noir";

  /*
     Re-ship attribution.

     Until now a re-ship only incremented a counter — the post never appeared in
     anybody's timeline, which made the button close to decorative. Reposts now
     surface in the Following feed, and this line is what stops that from looking
     like the reposter wrote it.
   */
  const repostBanner = repostedBy ? (
    <div className="mb-2 flex items-center gap-1.5 text-[12px] text-tertiary">
      <Repeat2 className="h-3.5 w-3.5 text-emerald-400/70" />
      <Link
        to="/u/$handle"
        params={{ handle: repostedBy.handle }}
        search={{ tab: undefined }}
        className="font-medium hover:underline underline-offset-2"
      >
        {repostedBy.display_name}
      </Link>
      <span>re-shipped</span>
    </div>
  ) : null;

  /* "edited" next to the timestamp, so an edit is never silent. */
  const editedMark = editedAt ? (
    <>
      <span className="mx-1.5 opacity-50">·</span>
      <span title={`Edited ${timeAgo(editedAt)}`}>edited</span>
    </>
  ) : null;

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

  /*
     Edit, for your own posts only.

     posts had an UPDATE policy from the first migration and no UI ever used it, so
     a typo was permanent and the only remedy was to delete and repost — losing the
     likes and the replies with it.
   */
  const editControl =
    isSelf && !editing ? (
      <button
        type="button"
        onClick={() => {
          setEditDraft(content);
          setEditing(true);
        }}
        className="rounded p-1 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
        aria-label="Edit post"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    ) : null;

  const ownerControls =
    editControl || deleteControl ? (
      <div className="flex shrink-0 items-center gap-0.5">
        {editControl}
        {deleteControl}
      </div>
    ) : null;

  /*
     The post body, or the edit form in its place.

     `tone` lets the Studio-card branch render the textarea against its theme
     instead of the app surface, so editing a card still looks like that card.
   */
  function renderBody(tone: { color: string; surface?: string; border?: string } | null) {
    if (editing) {
      return (
        <div className="mt-1">
          <textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            maxLength={MAX_POST_LENGTH}
            rows={4}
            aria-label="Edit your post"
            className="field w-full resize-y"
            style={
              tone?.surface
                ? { background: tone.surface, color: tone.color, borderColor: tone.border }
                : undefined
            }
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] tabular-nums text-tertiary">
              {editDraft.trim().length}/{MAX_POST_LENGTH}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setEditDraft(content);
                }}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={savePostEdit}
                disabled={savingEdit || !editDraft.trim()}
                className="btn btn-primary btn-sm"
              >
                {savingEdit && <Loader2 className="h-3 w-3 animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  /* Shared actions row */
  const actionsRow = (
    <div
      className="mt-3 flex items-center gap-1 border-t pt-2 text-secondary"
      style={{ borderColor: "var(--border)" }}
    >
      <button
        type="button"
        onClick={toggleLike}
        disabled={busyLike}
        className={actionBtn + (liked ? " text-rose-400" : " hover:text-foreground")}
        aria-label="Like"
      >
        <Heart className="h-4 w-4" fill={liked ? "currentColor" : "none"} />
        <span className="sr-only">{liked ? "Unlike" : "Like"}</span>
        {likeCount > 0 ? <span aria-label={`${likeCount} likes`}>{likeCount}</span> : null}
      </button>

      {commentsEnabled && (
        <button
          type="button"
          onClick={toggleThread}
          className={actionBtn + " hover:text-foreground"}
          aria-label="Comment"
        >
          <MessageCircle className="h-4 w-4" />
          <span className="sr-only">Replies</span>
          {commentCount > 0 ? (
            <span aria-label={`${commentCount} replies`}>{commentCount}</span>
          ) : null}
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
        <span className="sr-only">Re-ship</span>
        {repostCount > 0 ? <span aria-label={`${repostCount} re-ships`}>{repostCount}</span> : null}
      </button>

      <button
        type="button"
        onClick={toggleBookmark}
        disabled={busyBookmark}
        aria-pressed={bookmarked}
        className={actionBtn + (bookmarked ? " text-[var(--gold)]" : " hover:text-foreground")}
        aria-label={bookmarked ? "Remove from saved" : "Save post"}
        title={bookmarked ? "Remove from saved" : "Save for later"}
      >
        <Bookmark className="h-4 w-4" fill={bookmarked ? "currentColor" : "none"} />
      </button>

      <button
        type="button"
        onClick={() => onDownload(post)}
        className={actionBtn + " hover:text-foreground"}
        aria-label="Download card as an image"
        title="Download card as an image"
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
          <Flag className="h-4 w-4" fill={reported ? "currentColor" : "none"} />
        </button>
      )}
    </div>
  );

  /* Report form — opens under the actions row so a reason can be captured */
  const reportForm =
    reportOpen && !reported ? (
      <div
        className="mt-3 rounded-xl border p-3"
        style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
      >
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
          className="field mt-2 resize-none"
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
            className="btn btn-primary btn-sm"
          >
            {busyReport && <Loader2 className="h-3 w-3 animate-spin" />}
            Submit report
          </button>
        </div>
      </div>
    ) : null;

  /*
     One comment. `isReply` only changes the indent and avatar size — the depth cap
     lives in the database (guard_comment_depth), so there is no third level to
     render and no need for a generic depth parameter here.
   */
  function renderComment(c: CommentRow, isReply: boolean) {
    const mine = c.author.id === user?.id;
    const avatar = isReply ? "h-6 w-6" : "h-7 w-7";

    return (
      <div
        key={c.id}
        className={isReply ? "flex items-start gap-2 pl-7" : "flex items-start gap-2.5 pl-2"}
      >
        <div
          className={`grid ${avatar} shrink-0 overflow-hidden rounded-full border border-border bg-secondary/50 text-xs font-semibold`}
        >
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
          <RichText
            text={c.content}
            className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground/90"
          />
          {user ? (
            <button
              type="button"
              onClick={() => {
                setReplyParent(c);
                setCommentDraft(`@${c.author.handle} `);
              }}
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <CornerDownRight className="h-3 w-3" />
              Reply
            </button>
          ) : null}
        </div>
        {mine && (
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
    );
  }

  /*
     Groups the flat comment rows into two levels.
     One pass, so a long thread does not become quadratic.
   */
  const topLevelComments = comments?.filter((c) => !c.parent_id) ?? [];
  const repliesByParent = new Map<string, CommentRow[]>();
  for (const c of comments ?? []) {
    if (!c.parent_id) continue;
    const bucket = repliesByParent.get(c.parent_id);
    if (bucket) bucket.push(c);
    else repliesByParent.set(c.parent_id, [c]);
  }

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
            topLevelComments.map((parent) => {
              const replies = repliesByParent.get(parent.id);
              return (
                <div key={parent.id} className="space-y-2">
                  {renderComment(parent, false)}
                  {replies?.map((reply) => renderComment(reply, true))}
                </div>
              );
            })
          )}

          {user ? (
            <div className="px-2 pt-1">
              {/* Says who is being answered, and offers a way out of it. Without
                  this the box looks identical whether the reply joins a thread or
                  starts one. */}
              {replyParent ? (
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-tertiary">
                  <CornerDownRight className="h-3 w-3" />
                  <span>
                    Replying to{" "}
                    <span className="font-medium text-secondary">@{replyParent.author.handle}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setReplyParent(null);
                      setCommentDraft("");
                    }}
                    className="ml-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
              <div className="flex w-full items-center gap-2">
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
                  placeholder={replyParent ? "Write a reply…" : "Reply…"}
                  className="field min-w-0 flex-1 !rounded-full"
                />
                <button
                  type="button"
                  onClick={submitComment}
                  disabled={postingComment || !commentDraft.trim()}
                  className="btn-icon shrink-0 !rounded-full"
                  aria-label="Send reply"
                >
                  {postingComment ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
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
        {repostedBy && <div className="px-4 pt-3 sm:px-5">{repostBanner}</div>}

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
                <p className="mt-0.5 text-[12px] text-tertiary">
                  @{post.author.handle}
                  <span className="mx-1.5 opacity-50">·</span>
                  {timeAgo(post.created_at)}
                  {editedMark}
                </p>
              </div>
              {ownerControls}
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
            {editing ? (
              renderBody({ color: theme.body, surface: "rgba(0,0,0,0.06)", border: theme.border })
            ) : (
              <RichText
                text={content}
                className="whitespace-pre-wrap break-words text-[15px] font-medium leading-[1.6] tracking-[-0.01em]"
                style={{ color: theme.body }}
              />
            )}
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
    <article className={`group relative card card-interactive ${tierBorder}`}>
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
        {repostBanner}

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
                <p className="mt-0.5 text-[12px] text-tertiary">
                  @{post.author.handle}
                  <span className="mx-1.5 opacity-50">·</span>
                  {timeAgo(post.created_at)}
                  {editedMark}
                </p>
              </div>
              {ownerControls}
            </div>

            {/* Content */}
            {editing ? (
              renderBody(null)
            ) : (
              <RichText
                text={content}
                className="mt-2.5 whitespace-pre-wrap break-words text-[15px] leading-[1.65] text-foreground/95 tracking-[-0.01em]"
              />
            )}

            {actionsRow}
            {reportForm}
            {commentsThread}
          </div>
        </div>
      </div>
    </article>
  );
}

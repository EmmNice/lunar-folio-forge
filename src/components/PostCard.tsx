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
  Share2,
  MoreHorizontal,
  Pin,
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
import { secondaryHandle } from "@/lib/identity";
import { sharePost } from "@/lib/share";
import { describeEditTimeLeft, editTimeLeft } from "@/lib/post-edit";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  showPinnedLabel,
  onPinChanged,
}: {
  post: FeedPost;
  onDownload: (post: FeedPost) => void;
  currentUserId?: string;
  onDeleted?: (id: string) => void;
  /** Lets the parent list update its copy after an in-place edit. */
  onEdited?: (id: string, content: string, editedAt: string | null) => void;
  repostedBy?: RepostAttribution;
  stats?: PostStats;
  /** Render the "Pinned" line above the post — used at the top of a profile. */
  showPinnedLabel?: boolean;
  /** Told when you pin or unpin this post, so a profile can reorder itself. */
  onPinChanged?: (pinnedPostId: string | null) => void;
}) {
  const { user, profile, isAdmin, refreshProfile } = useAuth();

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
  const [sharing, setSharing] = useState(false);

  /*
    Share the permalink off-platform. On a phone this opens the OS share sheet;
    on desktop, where navigator.share mostly does not exist, it copies the link.
    A cancelled share sheet is silent — the person chose not to send it, so
    neither a success nor an error toast would be true.
  */
  async function onShare() {
    if (sharing) return;
    setSharing(true);
    try {
      const outcome = await sharePost({
        postId: post.id,
        authorName: post.author.display_name,
        authorHandle: post.author.handle,
        content: post.content,
      });
      if (outcome === "copied") toast.success("Link copied — paste it anywhere.");
      else if (outcome === "failed") toast.error("Couldn't share this post. Try again.");
    } finally {
      setSharing(false);
    }
  }

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

  /*
    Time left to edit, re-evaluated when it runs out so the Edit option disappears
    at the moment the database starts refusing it, not on the next re-render.
  */
  const [editMsLeft, setEditMsLeft] = useState(() =>
    (user?.id ?? currentUserId) === post.author.id ? editTimeLeft(post.created_at) : 0,
  );
  useEffect(() => {
    if (!isSelf) {
      setEditMsLeft(0);
      return;
    }
    const left = editTimeLeft(post.created_at);
    setEditMsLeft(left);
    if (left <= 0) return;
    // Tick each minute for the "N min left" label, and once more at expiry.
    const id = setInterval(
      () => {
        const next = editTimeLeft(post.created_at);
        setEditMsLeft(next);
        if (next <= 0) clearInterval(id);
      },
      Math.min(60_000, left),
    );
    return () => clearInterval(id);
  }, [isSelf, post.created_at]);

  const [busyPin, setBusyPin] = useState(false);
  async function togglePin() {
    if (!user || !profile || busyPin) return;
    const pinning = profile.pinned_post_id !== post.id;
    setBusyPin(true);
    const { error } = await supabase
      .from("profiles")
      .update({ pinned_post_id: pinning ? post.id : null })
      .eq("id", user.id);
    if (error) {
      setBusyPin(false);
      toast.error(describeWriteError(error.message, "pin this post"));
      return;
    }
    // The pin lives on your profile row, which every surface reads through
    // useAuth — refreshing it is what moves the "Pinned" label everywhere.
    await refreshProfile();
    setBusyPin(false);
    onPinChanged?.(pinning ? post.id : null);
    toast.success(pinning ? "Pinned to your profile." : "Unpinned.");
  }

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

  /*
     Owner / moderator actions, behind one "⋯" menu as on X.

     There used to be a pencil and a bin sitting next to the timestamp on every
     post you wrote. With pinning added that would have been three icons, so they
     moved into a menu — and the menu is a Radix portal, so it is never clipped by
     the post list it sits in.
   */
  const canDelete = (isSelf || isAdmin) && !!onDeleted;
  // Edit is offered only while the database would accept it (lib/post-edit.ts).
  const editOpenFor = isSelf ? editMsLeft : 0;
  const canEdit = isSelf && !editing && editOpenFor > 0;
  // Only public posts can be pinned (guard_pinned_post), so don't offer the rest.
  const canPin = isSelf && !!profile && post.visibility === "public";
  const isPinned = isSelf && profile?.pinned_post_id === post.id;

  const ownerControls =
    confirmDelete && canDelete ? (
      <div className="flex shrink-0 items-center gap-1.5">
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
    ) : canDelete || canEdit || canPin ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More options"
            className="-mr-1.5 -mt-1 shrink-0 rounded-full p-1.5 text-tertiary transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-[12rem] rounded-xl border-[var(--border)] bg-[var(--surface-1)] p-1"
        >
          {canPin ? (
            <DropdownMenuItem onSelect={togglePin} disabled={busyPin} className="gap-2.5 py-2">
              <Pin className="h-4 w-4" />
              {isPinned ? "Unpin from profile" : "Pin to your profile"}
            </DropdownMenuItem>
          ) : null}
          {canEdit ? (
            <DropdownMenuItem
              onSelect={() => {
                setEditDraft(content);
                setEditing(true);
              }}
              className="gap-2.5 py-2"
            >
              <Pencil className="h-4 w-4" />
              <span className="flex-1">Edit</span>
              <span className="text-[11px] text-tertiary">{describeEditTimeLeft(editOpenFor)}</span>
            </DropdownMenuItem>
          ) : null}
          {canDelete ? (
            <DropdownMenuItem
              onSelect={() => setConfirmDelete(true)}
              className="gap-2.5 py-2 text-red-400 focus:text-red-300"
            >
              <Trash2 className="h-4 w-4" />
              {isSelf ? "Delete" : "Remove as moderator"}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
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
  /*
     X-style action bar: no rule above it, icons spread across the text column
     rather than bunched at the left, Report pushed to the far end.
   */
  const actionsRow = (
    <div className="mt-1 -ml-2 flex max-w-[30rem] items-center justify-between text-tertiary">
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

      {/*
        Share sits next to Download because they answer the same question — "get
        this out of the app" — one as a link, one as an image.
      */}
      <button
        type="button"
        onClick={onShare}
        disabled={sharing}
        className={actionBtn + " hover:text-foreground"}
        aria-label="Share this post"
        title="Share this post"
      >
        <Share2 className="h-4 w-4" />
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

  /*
     One layout for every post, modelled on X: a flat row in a list rather than a
     boxed card. Avatar in a left column; name, badge, @handle and time on one line;
     the text directly underneath; the action bar under the text.

     Studio posts keep their theme, but as an inset block inside the row — the way
     X shows an attached image — instead of the whole post becoming a card. The
     downloadable image is unaffected: Download renders a separate off-screen
     StatusCard (hooks/use-card-export.tsx), never this element.

     The tier is still visible where it carries meaning — the avatar ring and the
     badge — rather than as a glowing border around the whole post.
   */
  const theme = isCardPost ? (THEMES[post.background ?? "cream"] ?? THEMES.cream) : null;
  const avatarRing =
    post.author.verification_tier === "gold"
      ? "ring-2 ring-amber-400/70 ring-offset-1 ring-offset-background"
      : post.author.verification_tier === "silver"
        ? "ring-2 ring-slate-400/60 ring-offset-1 ring-offset-background"
        : "";
  const handleLine = secondaryHandle(post.author.display_name, post.author.handle);

  return (
    <article className="post-row group relative px-4 pt-3 pb-1.5 transition-colors hover:bg-white/[0.018] sm:px-5">
      {showPinnedLabel ? (
        <div className="mb-1 flex items-center gap-1.5 pl-[52px] text-[12px] font-semibold text-tertiary">
          <Pin className="h-3 w-3" />
          Pinned
        </div>
      ) : null}
      {repostedBy ? <div className="pl-[52px]">{repostBanner}</div> : null}

      <div className="flex gap-3">
        {/* Avatar column */}
        <Link
          to="/u/$handle"
          params={{ handle: post.author.handle }}
          search={{ tab: undefined }}
          className="shrink-0 self-start"
        >
          <div
            className={`grid h-10 w-10 overflow-hidden rounded-full bg-secondary/60 transition-opacity hover:opacity-85 ${avatarRing}`}
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
          {/* Name · @handle · time — one line, truncating like X */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1 text-[14.5px] leading-5">
              <Link
                to="/u/$handle"
                params={{ handle: post.author.handle }}
                search={{ tab: undefined }}
                className="inline-flex min-w-0 items-center gap-1 font-bold text-foreground hover:underline underline-offset-2"
              >
                <span className="truncate">{post.author.display_name}</span>
                <VerificationBadge tier={post.author.verification_tier} size={15} />
              </Link>
              <span className="flex min-w-0 items-center text-tertiary">
                {handleLine ? <span className="ml-0.5 truncate">{handleLine}</span> : null}
                <span className="mx-1 shrink-0 opacity-60">·</span>
                <Link
                  to="/p/$id"
                  params={{ id: post.id }}
                  className="shrink-0 hover:underline underline-offset-2"
                  title={new Date(post.created_at).toLocaleString()}
                >
                  {timeAgo(post.created_at)}
                </Link>
                {editedMark}
              </span>
            </div>
            {ownerControls}
          </div>

          {(isVerifiedOnly || isWhisper) && (
            <span
              className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
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

          {/* Body */}
          {theme ? (
            <div
              className="mt-2 rounded-2xl px-4 py-4"
              style={{
                backgroundColor: theme.bg,
                backgroundImage: `radial-gradient(${theme.dot} 1px, transparent 1px)`,
                backgroundSize: "18px 18px",
                border: `1px solid ${theme.border}`,
              }}
            >
              {editing ? (
                renderBody({ color: theme.body, surface: "rgba(0,0,0,0.06)", border: theme.border })
              ) : (
                <RichText
                  text={content}
                  className="whitespace-pre-wrap break-words text-[15px] font-medium leading-[1.5]"
                  style={{ color: theme.body }}
                />
              )}
            </div>
          ) : editing ? (
            renderBody(null)
          ) : (
            <RichText
              text={content}
              className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-[1.5] text-foreground/95"
            />
          )}

          {actionsRow}
          {reportForm}
          {commentsThread}
        </div>
      </div>
    </article>
  );
}

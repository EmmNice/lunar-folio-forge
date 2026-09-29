import { useEffect, useState } from "react";
import { Bookmark } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, PostSkeleton } from "@/components/states";
import { PostCard, type FeedPost } from "@/components/PostCard";
import { toBackground } from "@/components/StatusCard";
import type { VerificationTier } from "@/hooks/use-auth";
import { useCardExport } from "@/hooks/use-card-export";

/**
 * The viewer's own saved posts.
 *
 * Only ever their own: `bookmarks` has no policy letting anyone read another
 * member's rows, so this component could not show somebody else's saves even if it
 * were rendered on their profile by mistake. That is deliberate — a public "saved"
 * list is a behavioural profile nobody agreed to publish.
 *
 * A saved post whose author has since blocked the viewer, or been suspended, comes
 * back with a null `post` through the join because the posts SELECT policy filters
 * it. Those rows are dropped rather than rendered as blanks.
 */

type RawRow = {
  post: {
    id: string;
    content: string;
    background: string | null;
    comments_enabled: boolean | null;
    visibility: string | null;
    created_at: string;
    edited_at: string | null;
    author: {
      id: string;
      handle: string;
      display_name: string;
      avatar_url: string | null;
      verification_tier: string;
    } | null;
  } | null;
};

export function SavedPosts({ userId }: { userId: string }) {
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const { requestExport, exportSurface } = useCardExport();

  useEffect(() => {
    let cancelled = false;
    setPosts(null);
    (async () => {
      const { data } = await supabase
        .from("bookmarks")
        .select(
          "created_at, post:posts!bookmarks_post_id_fkey(id, content, background, comments_enabled, visibility, created_at, edited_at, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, verification_tier))",
        )
        .eq("user_id", userId)
        // Newest save first, not newest post: this is a reading list.
        .order("created_at", { ascending: false })
        .limit(50);

      if (cancelled) return;
      const shaped = ((data ?? []) as unknown as RawRow[])
        .map((r) => r.post)
        .filter((p): p is NonNullable<RawRow["post"]> => p !== null && p.author !== null)
        .map((p) => ({
          id: p.id,
          content: p.content,
          background: toBackground(p.background),
          comments_enabled: p.comments_enabled ?? true,
          visibility: p.visibility ?? "public",
          created_at: p.created_at,
          edited_at: p.edited_at,
          author: {
            ...p.author!,
            verification_tier: p.author!.verification_tier as VerificationTier,
          },
        }));
      setPosts(shaped);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (posts === null) return <PostSkeleton count={3} />;

  if (posts.length === 0) {
    return (
      <EmptyState
        icon={Bookmark}
        title="Nothing saved yet"
        description="Tap the bookmark on any post to keep it here. Saves are private — nobody else can see them."
      />
    );
  }

  return (
    <>
      <div className="space-y-3">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            currentUserId={userId}
            onDownload={requestExport}
            /* Unsaving from this list should remove the card, which is what the
               bookmark button already does to its own state — but the list needs to
               drop the row too or an unsaved post lingers until a reload. */
            onDeleted={(id) => setPosts((prev) => prev?.filter((p) => p.id !== id) ?? null)}
          />
        ))}
      </div>
      {exportSurface}
    </>
  );
}

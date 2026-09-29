import { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import { BACKGROUND_BASE_COLORS, StatusCard } from "@/components/StatusCard";
import type { FeedPost } from "@/components/PostCard";

const EXPORT_WIDTH = 1080;
const EXPORT_HEIGHT = 1920;
const FALLBACK_BACKGROUND = "#0b0b0c";

/**
 * Renders a post as a 1080x1920 PNG and downloads it.
 *
 * html-to-image needs the card in the DOM at full size, so the card is mounted
 * off-screen and captured on the next effect pass. The feed and the profile page
 * both need this, and the profile page's download buttons used to be wired to an
 * empty handler, so it lives here rather than in either route.
 *
 * Render `exportSurface` somewhere in the tree and call `requestExport(post)`.
 */
export function useCardExport() {
  const exportRef = useRef<HTMLDivElement | null>(null);
  const [post, setPost] = useState<FeedPost | null>(null);

  useEffect(() => {
    if (!post || !exportRef.current) return;

    let cancelled = false;
    const node = exportRef.current;

    (async () => {
      try {
        const dataUrl = await toPng(node, {
          pixelRatio: 1,
          cacheBust: true,
          backgroundColor: BACKGROUND_BASE_COLORS[post.background] ?? FALLBACK_BACKGROUND,
          width: EXPORT_WIDTH,
          height: EXPORT_HEIGHT,
        });
        if (cancelled) return;

        const link = document.createElement("a");
        link.download = `${post.author.handle}-status.png`;
        link.href = dataUrl;
        link.click();
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Export failed.");
        }
      } finally {
        if (!cancelled) setPost(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [post]);

  const exportSurface = post ? (
    <div
      aria-hidden
      style={{ position: "fixed", top: 0, left: 0, pointerEvents: "none", opacity: 0, zIndex: -1 }}
    >
      <StatusCard
        ref={exportRef}
        name={post.author.display_name}
        handle={post.author.handle}
        avatarUrl={post.author.avatar_url}
        content={post.content}
        background={post.background}
        verificationTier={post.author.verification_tier}
        watermark
        exportMode
      />
    </div>
  ) : null;

  return { requestExport: setPost, exportSurface };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import { toast } from "sonner";
import { BACKGROUND_BASE_COLORS, StatusCard } from "@/components/StatusCard";
import type { FeedPost } from "@/components/PostCard";

const EXPORT_WIDTH = 1080;
const EXPORT_HEIGHT = 1920;
const FALLBACK_BACKGROUND = "#0b0b0c";

/**
 * Saves the PNG as a normal file download.
 *
 * The link is put in the document before being clicked and removed afterwards.
 * A detached anchor's synthetic click is ignored by some browsers, which is a
 * silent failure — nothing downloads and nothing errors.
 */
function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.download = file.name;
  link.href = url;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before dropping the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Renders a post as a 1080x1920 PNG and downloads it.
 *
 * One tap, one file, no intermediate UI. This previously routed through
 * `navigator.share()` on mobile, on the reasoning that the OS share sheet is the
 * only way a web page can get an image into the camera roll. That is technically
 * true and beside the point: the button says download, and it made the member pick
 * a destination out of a list every single time. A download that always works the
 * same way is worth more than one that occasionally lands somewhere nicer.
 *
 * Where the file ends up is the browser's business: Downloads on Android (visible
 * in Google Photos under the Download album), Files on iOS, the download folder on
 * desktop. A website cannot write to the gallery directly, and pretending
 * otherwise is what produced the share sheet.
 *
 * Render `exportSurface` somewhere in the tree and call `requestExport(post)`.
 */
export function useCardExport() {
  const exportRef = useRef<HTMLDivElement | null>(null);
  const [post, setPost] = useState<FeedPost | null>(null);
  const mountedRef = useRef<(() => void) | null>(null);
  const busyRef = useRef(false);

  // Signals back to requestExport that the off-screen card is in the DOM.
  useEffect(() => {
    if (!post || !exportRef.current) return;
    const resolve = mountedRef.current;
    mountedRef.current = null;
    resolve?.();
  }, [post]);

  const save = useCallback((file: File) => {
    downloadFile(file);
    toast.success("Card downloaded.");
  }, []);

  const requestExport = useCallback(
    async (next: FeedPost) => {
      if (busyRef.current) return;
      busyRef.current = true;

      try {
        // Mount the off-screen card and wait for the DOM, staying inside the
        // chain the tap began.
        await new Promise<void>((resolve) => {
          mountedRef.current = resolve;
          setPost(next);
        });

        const node = exportRef.current;
        if (!node) throw new Error("Could not render the card.");

        const blob = await toBlob(node, {
          pixelRatio: 1,
          cacheBust: true,
          backgroundColor: BACKGROUND_BASE_COLORS[next.background] ?? FALLBACK_BACKGROUND,
          width: EXPORT_WIDTH,
          height: EXPORT_HEIGHT,
        });
        if (!blob) throw new Error("Could not render the card.");

        const file = new File([blob], `the-ledger-${next.author.handle}.png`, {
          type: "image/png",
        });

        save(file);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't save the card.");
      } finally {
        busyRef.current = false;
        mountedRef.current = null;
        setPost(null);
      }
    },
    [save],
  );

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

  return { requestExport, exportSurface };
}

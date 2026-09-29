import { useCallback, useEffect, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import { toast } from "sonner";
import { BACKGROUND_BASE_COLORS, StatusCard } from "@/components/StatusCard";
import type { FeedPost } from "@/components/PostCard";

/**
 * Card geometry, in CSS pixels. 9:16, which is what every story surface expects.
 *
 * The exported file is this multiplied by EXPORT_PIXEL_RATIO, so the layout is
 * authored once at a comfortable size and rasterised at a much higher one.
 */
const EXPORT_WIDTH = 1080;
const EXPORT_HEIGHT = 1920;

/**
 * Supersampling factor for the PNG.
 *
 * At 1 the file came out exactly 1080x1920 — a fine size, and still visibly soft,
 * because every glyph edge and the avatar ring were sampled once per output pixel.
 * At 2 the card rasterises at 2160x3840 and downscales beautifully on any phone,
 * which is what makes text look printed rather than rendered.
 *
 * The cost is real and worth stating: the canvas is 2160 * 3840 * 4 bytes, about
 * 33 MB, held while encoding. Desktop and current phones handle that without
 * noticing; an older device can fail to allocate it. `renderCard` falls back to 1
 * in that case rather than returning nothing, so the worst outcome is the file we
 * used to produce.
 */
const EXPORT_PIXEL_RATIO = 2;

const FALLBACK_BACKGROUND = "#0b0b0c";

/**
 * Rasterises the card, dropping to a lower resolution rather than failing.
 *
 * A 33 MB canvas is not guaranteed on every device. Rather than let an allocation
 * failure surface as "couldn't save the card" — which tells the member nothing and
 * loses work they asked to keep — this retries at 1x. A slightly softer card is a
 * far better outcome than none, and the only way to know the difference is to
 * compare two files side by side.
 */
async function renderCard(node: HTMLElement, backgroundColor: string): Promise<Blob | null> {
  const attempt = (pixelRatio: number) =>
    toBlob(node, {
      pixelRatio,
      cacheBust: true,
      backgroundColor,
      width: EXPORT_WIDTH,
      height: EXPORT_HEIGHT,
    });

  try {
    const hi = await attempt(EXPORT_PIXEL_RATIO);
    if (hi) return hi;
    console.warn("[card] High-resolution render returned nothing; retrying at 1x.");
  } catch (error) {
    console.warn("[card] High-resolution render failed; retrying at 1x.", error);
  }

  return attempt(1);
}

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

        /*
          Wait for Inter before rasterising.

          html-to-image draws whatever the browser has resolved at the moment of
          capture. If the webfont has not finished loading, the card is rendered in
          the system fallback — same layout, wrong typeface, and the result looks
          cheap in a way that is hard to name and impossible to miss. This is the
          single biggest quality difference in the output and it costs nothing on a
          warm page, because the font is already in use on screen.
        */
        if (typeof document !== "undefined" && document.fonts?.ready) {
          try {
            await document.fonts.ready;
          } catch {
            // A font-loading failure is not a reason to refuse the download.
          }
        }

        const blob = await renderCard(
          node,
          BACKGROUND_BASE_COLORS[next.background] ?? FALLBACK_BACKGROUND,
        );
        if (!blob) throw new Error("The card couldn't be rendered. Try again.");

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

import { useCallback, useEffect, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import { toast } from "sonner";
import { BACKGROUND_BASE_COLORS, StatusCard } from "@/components/StatusCard";
import type { FeedPost } from "@/components/PostCard";

const EXPORT_WIDTH = 1080;
const EXPORT_HEIGHT = 1920;
const FALLBACK_BACKGROUND = "#0b0b0c";

/** `navigator.canShare` is still missing from some TS lib.dom versions. */
type ShareCapableNavigator = Navigator & {
  canShare?: (data?: ShareData) => boolean;
};

function canShareFile(file: File): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as ShareCapableNavigator;
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** Desktop path: a normal file download. */
function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.download = file.name;
  link.href = url;
  link.click();
  // Give the browser a moment to start the download before dropping the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Renders a post as a 1080x1920 PNG and saves it to the device.
 *
 * On a phone this hands the image to the OS share sheet, where "Save Image" puts
 * it straight into Photos (iOS) or the gallery (Android). It used to click a
 * synthetic `<a download>` instead, which on mobile is treated as a web file
 * download: iOS dropped it into Files rather than Photos, and Android filed it
 * under Downloads as though it had come off the internet. A website cannot write
 * to the camera roll directly — the share sheet is the platform's route for it —
 * so the sheet is the primary path and the download is the desktop fallback.
 *
 * The capture has to stay inside the promise chain that the tap started. Safari
 * only allows `navigator.share()` under transient user activation, and the old
 * arrangement (set state, capture later in an effect) severed that chain. So
 * `requestExport` awaits the off-screen card mounting and then captures and
 * shares without ever returning to the event loop on its own terms. If activation
 * is lost anyway on a slow device, the toast offers a second tap, which restores
 * it rather than silently falling back to a download the member did not ask for.
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

  const save = useCallback(async (file: File) => {
    if (canShareFile(file)) {
      try {
        await (navigator as ShareCapableNavigator).share({
          files: [file],
          title: "The Ledger",
        });
        return;
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        // The member dismissed the sheet. Nothing went wrong.
        if (name === "AbortError") return;
        // Activation expired while the image was rendering. A fresh tap fixes it.
        if (name === "NotAllowedError") {
          toast("Your card is ready", {
            description: "Tap to save it to your photos.",
            action: {
              label: "Save",
              onClick: () => {
                (navigator as ShareCapableNavigator)
                  .share({ files: [file], title: "The Ledger" })
                  .catch((retryError: unknown) => {
                    if (retryError instanceof Error && retryError.name === "AbortError") return;
                    downloadFile(file);
                  });
              },
            },
            duration: 15_000,
          });
          return;
        }
        // Anything else: fall through to the download rather than lose the card.
      }
    }

    downloadFile(file);
    toast.success("Card saved.");
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

        await save(file);
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

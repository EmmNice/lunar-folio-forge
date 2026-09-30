/**
 * Sharing a post off-platform.
 *
 * Every card gets a permalink at /p/<id>, and that is what goes out — not the
 * feed URL, which would land the recipient on a timeline that may not even
 * contain the post any more.
 *
 * On a phone `navigator.share` opens the OS share sheet, which is the whole point
 * of the request: WhatsApp, X, Telegram and the rest without the app needing to
 * know about any of them. Desktop browsers mostly do not implement it, so there
 * the link is copied to the clipboard instead.
 */

export type ShareOutcome = "shared" | "copied" | "dismissed" | "failed";

export function postPermalink(postId: string): string {
  // Relative would be shorter, but this string is going into someone else's
  // WhatsApp — it has to be absolute to be clickable.
  const origin =
    typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
  return `${origin}/p/${postId}`;
}

/** First line of the post, trimmed, for the share sheet's preview text. */
function previewText(content: string, max = 120): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  // Cut on a word boundary so the preview does not end mid-word.
  return (
    oneLine.slice(0, oneLine.lastIndexOf(" ", max) > 0 ? oneLine.lastIndexOf(" ", max) : max) + "…"
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permissions policy, or a non-secure context. Fall through to the fallback.
  }
  // execCommand is deprecated but is still the only thing that works on older
  // mobile Safari and inside some in-app webviews.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export async function sharePost(opts: {
  postId: string;
  authorName: string;
  authorHandle: string;
  content: string;
}): Promise<ShareOutcome> {
  const url = postPermalink(opts.postId);
  const title = `${opts.authorName} (@${opts.authorHandle}) on The Ledger`;

  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title, text: previewText(opts.content), url });
      return "shared";
    } catch (e) {
      /*
        A cancelled share sheet rejects with AbortError. That is the user
        declining, not a failure, and must not raise an error toast — nor fall
        through to silently copying a link they chose not to send.
      */
      if (e instanceof DOMException && e.name === "AbortError") return "dismissed";
      // Anything else (NotAllowedError, an unsupported payload) still deserves a
      // working path, so fall through to the clipboard.
    }
  }

  return (await copyToClipboard(url)) ? "copied" : "failed";
}

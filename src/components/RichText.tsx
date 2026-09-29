import { Link } from "@tanstack/react-router";
import { Fragment } from "react";

/**
 * Renders post and comment text with @mentions and URLs made interactive.
 *
 * Mentions were already meaningful in the database — the notify_mentions trigger
 * resolves them and notifies the person (20260930000200) — but on screen they were
 * inert text. So being mentioned sent an alert to a post where your name was not
 * clickable, and following a conversation meant copying a handle into search.
 *
 * Built by splitting on a single regex rather than by injecting HTML. There is no
 * dangerouslySetInnerHTML here and there should never be: this text is written by
 * other members, and the whole point of returning React nodes is that a post
 * containing `<img onerror=...>` renders as the characters someone typed.
 */

/**
 * One pattern, two alternatives, so a single pass keeps the pieces in order.
 *
 * The handle half mirrors the database rule (`[a-z0-9_]{2,20}`) and is
 * case-insensitive here because people capitalise names mid-sentence; the link
 * target is lowercased to match how handles are stored. `(?<![\w@])` stops it
 * matching inside an email address — `a@b.com` is not a mention of @b.
 */
const TOKEN = /(?<![\w@])@([A-Za-z0-9_]{2,20})\b|(https?:\/\/[^\s<]+)/g;

export function RichText({
  text,
  className,
  style,
}: {
  text: string;
  className?: string;
  /** Studio cards set their own body colour from the card theme. */
  style?: React.CSSProperties;
}) {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));

    const [full, handle, url] = match;

    if (handle) {
      nodes.push(
        <Link
          key={`m${key++}`}
          to="/u/$handle"
          params={{ handle: handle.toLowerCase() }}
          search={{ tab: undefined }}
          className="font-medium text-[var(--gold)] hover:underline underline-offset-2"
          /* The mention sits inside a card that is itself often clickable. */
          onClick={(e) => e.stopPropagation()}
        >
          @{handle}
        </Link>,
      );
    } else if (url) {
      nodes.push(
        <a
          key={`u${key++}`}
          href={url}
          target="_blank"
          /* noreferrer as well as noopener: a member's post should not leak the
             page it was read from to an arbitrary third party. */
          rel="noreferrer noopener"
          className="text-sky-400 hover:underline underline-offset-2 break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {url.replace(/^https?:\/\//, "")}
        </a>,
      );
    } else {
      nodes.push(full);
    }

    lastIndex = index + full.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));

  return (
    <p className={className} style={style}>
      {nodes.map((n, i) => (
        <Fragment key={i}>{n}</Fragment>
      ))}
    </p>
  );
}

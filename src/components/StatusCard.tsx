import { forwardRef } from "react";
import { VerificationBadge, type VerificationTier } from "@/components/VerificationBadge";

export type Background = "noir" | "cream" | "gradient" | "gold" | "steel" | "emerald" | "midnight";

/**
 * Narrows the free-text `posts.background` column to a known theme.
 * Unrecognised values fall back to noir rather than rendering an undefined theme.
 */
export function toBackground(value: string | null | undefined): Background {
  return value && value in BACKGROUND_BASE_COLORS ? (value as Background) : "noir";
}

/** Base fill color used as the toPng backgroundColor for each theme */
export const BACKGROUND_BASE_COLORS: Record<Background, string> = {
  noir: "#0b0b0c",
  cream: "#f5f0e6",
  gradient: "#0d0a1a",
  gold: "#0f0c04",
  steel: "#080c14",
  emerald: "#030f09",
  midnight: "#040812",
};

export type StatusCardProps = {
  name: string;
  title?: string;
  content: string;
  handle?: string;
  avatarUrl?: string | null;
  background?: Background;
  exportMode?: boolean;
  verificationTier?: VerificationTier | null;
  watermark?: boolean;
};

type ThemeConfig = {
  bg: string;
  /** Optional gradient layered behind the dot pattern */
  bgGradient?: string;
  dot: string;
  fg: string;
  body: string;
  muted: string;
  border: string;
  avatarBg: string;
  /** True for themes with a light background, where tier colours need darkening. */
  light?: boolean;
};

export const THEMES: Record<Background, ThemeConfig> = {
  noir: {
    bg: "#0b0b0c",
    dot: "rgba(255,255,255,0.07)",
    fg: "#ffffff",
    body: "#e5e7eb",
    muted: "#94a3b8",
    border: "#1f2937",
    avatarBg: "#111214",
  },
  cream: {
    bg: "#f5f0e6",
    dot: "rgba(0,0,0,0.07)",
    fg: "#111111",
    body: "#1f1f1f",
    muted: "#6b6357",
    border: "#d9d1bf",
    avatarBg: "#ecead9",
    light: true,
  },
  gradient: {
    bg: "#0d0a1a",
    bgGradient: "linear-gradient(145deg, #1a0d2e 0%, #0d0a1a 50%, #0a0d1e 100%)",
    dot: "rgba(167,139,250,0.06)",
    fg: "#f0ecff",
    body: "#d4cff5",
    muted: "#8b7fd4",
    border: "rgba(167,139,250,0.18)",
    avatarBg: "#1a1230",
  },
  gold: {
    bg: "#0f0c04",
    bgGradient: "linear-gradient(145deg, #211700 0%, #0f0c04 50%, #0c0a02 100%)",
    dot: "rgba(251,191,36,0.06)",
    fg: "#fefce8",
    body: "#fde68a",
    muted: "#b89a45",
    border: "rgba(251,191,36,0.20)",
    avatarBg: "#1c1400",
  },
  steel: {
    bg: "#080c14",
    bgGradient: "linear-gradient(145deg, #0d1525 0%, #080c14 50%, #06080f 100%)",
    dot: "rgba(148,163,184,0.06)",
    fg: "#e8edf5",
    body: "#c8d4e0",
    muted: "#6b8aaa",
    border: "rgba(148,163,184,0.18)",
    avatarBg: "#0f1824",
  },
  emerald: {
    bg: "#030f09",
    bgGradient: "linear-gradient(145deg, #061a0e 0%, #030f09 50%, #020c07 100%)",
    dot: "rgba(52,211,153,0.06)",
    fg: "#ecfdf5",
    body: "#a7f3d0",
    muted: "#4a9970",
    border: "rgba(52,211,153,0.18)",
    avatarBg: "#041a0c",
  },
  midnight: {
    bg: "#040812",
    bgGradient: "linear-gradient(145deg, #060d20 0%, #040812 50%, #030610 100%)",
    dot: "rgba(99,102,241,0.06)",
    fg: "#eef2ff",
    body: "#c7d2fe",
    muted: "#6272cc",
    border: "rgba(99,102,241,0.18)",
    avatarBg: "#080e28",
  },
};

/**
 * Tier presentation on the card.
 *
 * A verified card has to *look* verified at thumbnail size, on someone else's
 * timeline, with no context. A 14px tick beside a name does not survive that —
 * which is the whole problem with treating the badge as an afterthought on an asset
 * whose only job is to travel.
 *
 * Light themes get darker inks: the same yellow that reads as gold on near-black is
 * nearly invisible on cream.
 */
const TIER_STYLE: Record<"silver" | "gold", { ink: string; inkLight: string; edge: string }> = {
  gold: {
    ink: "#facc15",
    inkLight: "#8a6d0b",
    edge: "rgba(250,204,21,0.38)",
  },
  silver: {
    ink: "#cbd5e1",
    inkLight: "#55606e",
    edge: "rgba(203,213,225,0.30)",
  },
};

/**
 * The Ledger mark — three ascending bars, the last one gold.
 *
 * Inlined rather than imported from AppHeader because that copy hardcodes the
 * app's own palette, and this one has to sit on seven different card themes. Same
 * geometry, theme-aware fill.
 */
function CardMark({ size, ink }: { size: number; ink: string }) {
  return (
    <svg
      width={size}
      height={(size / 22) * 18}
      viewBox="0 0 22 18"
      fill="none"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <rect x="0" y="9" width="5" height="9" rx="1.5" fill={ink} />
      <rect x="8.5" y="4.5" width="5" height="13.5" rx="1.5" fill={ink} />
      <rect x="17" y="0" width="5" height="18" rx="1.5" fill="#FBBF24" />
    </svg>
  );
}

export const StatusCard = forwardRef<HTMLDivElement, StatusCardProps>(function StatusCard(
  {
    name,
    title,
    content,
    handle = "",
    avatarUrl,
    background = "noir",
    exportMode = false,
    verificationTier = null,
    watermark = false,
  },
  ref,
) {
  const t = THEMES[background];
  const tier =
    verificationTier === "gold" || verificationTier === "silver" ? verificationTier : null;
  const tierStyle = tier ? TIER_STYLE[tier] : null;
  const tierInk = tierStyle ? (t.light ? tierStyle.inkLight : tierStyle.ink) : t.muted;

  /** One scale factor, so the export and the on-screen preview stay in proportion. */
  const px = (exportPx: number, previewEm: string) => (exportMode ? exportPx : previewEm);

  /*
    Body type scales to the length of the post.

    A fixed size cannot serve both ends of a 280-character range on a 9:16 canvas:
    set it for a paragraph and a three-word post is a whisper in an empty frame; set
    it for the three words and anything real overflows. Short posts get to be a
    statement, long ones stay comfortable. The thresholds are eyeballed against the
    280-character cap rather than computed, which is the honest way to describe them.
  */
  const length = (content || "").trim().length;
  const bodySize =
    length <= 70
      ? px(96, "2.5em")
      : length <= 140
        ? px(76, "2em")
        : length <= 210
          ? px(62, "1.65em")
          : px(52, "1.4em");

  const styles: React.CSSProperties = exportMode
    ? { width: 1080, height: 1920, padding: "150px 104px 128px" }
    : { aspectRatio: "1080 / 1920", width: "100%", padding: "8.5% 6.5% 7%" };

  const initial = (name.trim() || "•").charAt(0).toUpperCase();

  const card = (
    <div
      ref={ref}
      style={{
        ...styles,
        backgroundColor: t.bg,
        /*
          The dot texture is dropped from the export.

          It is barely visible at 6-7% alpha, and it is high-frequency noise across
          the whole frame — which is the worst possible input for the JPEG pass every
          messaging app applies on the way out. The encoder spends its bit budget
          describing a dither pattern nobody can see, and pays for it with blocking
          and mosquito noise around the text, which everybody can. Sharing the card
          through WhatsApp is the main thing it is for, so the export keeps the smooth
          gradient and loses the speckle. On screen, where nothing is re-encoded, the
          texture stays.
        */
        backgroundImage: exportMode
          ? (t.bgGradient ?? "none")
          : t.bgGradient
            ? `${t.bgGradient}, radial-gradient(${t.dot} 1px, transparent 1px)`
            : `radial-gradient(${t.dot} 1px, transparent 1px)`,
        backgroundSize: exportMode
          ? "100% 100%"
          : t.bgGradient
            ? `100% 100%, 22px 22px`
            : "22px 22px",
        color: t.fg,
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        overflow: "hidden",
        borderRadius: exportMode ? 0 : 20,
        position: "relative",
      }}
    >
      {/*
        A hairline of the tier colour across the top edge.
        This is the part that reads at thumbnail size — before the name is legible,
        before the badge is, the card is already visibly a verified one.
      */}
      {tierStyle ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: exportMode ? 8 : 3,
            background: `linear-gradient(90deg, transparent 0%, ${tierStyle.edge} 18%, ${tierInk} 50%, ${tierStyle.edge} 82%, transparent 100%)`,
          }}
        />
      ) : null}

      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: px(30, "1.15em") }}>
        <div
          style={{
            width: px(124, "3.5em"),
            height: px(124, "3.5em"),
            borderRadius: "9999px",
            /* Verified avatars get a ring in the tier colour rather than the
               generic border — the same signal the app itself uses. */
            border: `${exportMode ? (tier ? 4 : 1) : tier ? 2 : 1}px solid ${tier ? tierInk : t.border}`,
            backgroundColor: t.avatarBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 600,
            fontSize: px(50, "1.6em"),
            color: t.fg,
            letterSpacing: "-0.02em",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              crossOrigin="anonymous"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            initial
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: px(14, "0.4em") }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: px(14, "0.28em"),
              fontSize: px(66, "2em"),
              fontWeight: 700,
              letterSpacing: "-0.035em",
              lineHeight: 1.08,
              color: t.fg,
            }}
          >
            <span>{name || "Your Name"}</span>
            <VerificationBadge
              tier={verificationTier}
              size={exportMode ? 46 : 18}
              exportMode={exportMode}
            />
          </div>

          {/*
            No text pill here. It was added on the reasoning that spelling out the
            tier would mean more to someone meeting the platform in a screenshot —
            and in place it just crowded the name with shouty uppercase. The tick
            beside the name, the ring on the avatar and the hairline along the top
            edge already say verified three times over.
          */}

          {title ? (
            <div
              style={{
                fontSize: px(32, "1em"),
                color: t.muted,
                letterSpacing: "-0.01em",
              }}
            >
              {title}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── The post ─────────────────────────────────────────────────────── */}
      {/*
        The body sits directly under the identity block, and the slack goes to the
        bottom instead of being split around the text.

        Centring it in a flex:1 row looked right in the abstract and awful in
        practice: a two-word post ended up as one small line marooned between two
        huge voids, with the identity crammed at the top and the footer stranded at
        the bottom. Weight belongs in the upper two thirds where the eye starts, and
        space at the bottom reads as margin rather than as something missing.
      */}
      <div
        style={{
          marginTop: px(72, "2em"),
          fontSize: bodySize,
          lineHeight: 1.32,
          color: t.body,
          fontWeight: 600,
          letterSpacing: "-0.028em",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {content || "Write something worth reading."}
      </div>

      {/* Absorbs the remaining height so the footer stays pinned. */}
      <div style={{ flex: 1, minHeight: px(40, "1em") }} />

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: px(24, "1em"),
          paddingTop: px(40, "1.2em"),
          borderTop: `1px solid ${t.border}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontSize: px(30, "0.9em"),
            color: t.fg,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            opacity: 0.9,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {handle ? (handle.startsWith("@") ? handle : `@${handle}`) : ""}
        </div>

        {/*
          The brand lockup replaces three social icons that were drawn on every card
          whether or not the member had any of those accounts — decoration shaped
          like information, and the one detail that made the card look generated
          rather than published. This says where the card came from, which is the
          only thing the footer was ever for.
        */}
        {watermark ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: px(12, "0.42em"),
              flexShrink: 0,
            }}
          >
            <CardMark size={exportMode ? 30 : 14} ink={t.fg} />
            <span
              style={{
                fontSize: px(26, "0.8em"),
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: t.muted,
              }}
            >
              The Ledger
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );

  if (exportMode) return card;

  /*
    The preview is laid out in em, so its type has to scale with the card's width
    or a small preview overflows: at the default 16px a 128px-wide card drew a
    56px avatar and a 32px name, and the name ran off the edge. Sizing the root
    font to the card's own width (5% = 16px at 320px, the size it was designed at)
    keeps every preview a true scale model of the 1080x1920 export.
  */
  return (
    <div style={{ containerType: "inline-size", width: "100%" }}>
      <div style={{ fontSize: "5cqw" }}>{card}</div>
    </div>
  );
});

import { forwardRef } from "react";
import { Github, Linkedin, Twitter } from "lucide-react";
import { VerificationBadge, type VerificationTier } from "@/components/VerificationBadge";

export type Background = "noir" | "cream" | "gradient" | "gold" | "steel" | "emerald" | "midnight";

/** Base fill color used as the toPng backgroundColor for each theme */
export const BACKGROUND_BASE_COLORS: Record<Background, string> = {
  noir:     "#0b0b0c",
  cream:    "#f5f0e6",
  gradient: "#0d0a1a",
  gold:     "#0f0c04",
  steel:    "#080c14",
  emerald:  "#030f09",
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

export const StatusCard = forwardRef<HTMLDivElement, StatusCardProps>(
  function StatusCard(
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
    const styles: React.CSSProperties = exportMode
      ? { width: 1080, height: 1920, padding: "160px 110px" }
      : { aspectRatio: "1080 / 1920", width: "100%", padding: "9% 7%" };

    const initial = (name.trim() || "•").charAt(0).toUpperCase();

    return (
      <div
        ref={ref}
        style={{
          ...styles,
          backgroundColor: t.bg,
          backgroundImage: t.bgGradient
            ? `${t.bgGradient}, radial-gradient(${t.dot} 1px, transparent 1px)`
            : `radial-gradient(${t.dot} 1px, transparent 1px)`,
          backgroundSize: t.bgGradient
            ? `100% 100%, ${exportMode ? "44px 44px" : "22px 22px"}`
            : exportMode ? "44px 44px" : "22px 22px",
          color: t.fg,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          boxSizing: "border-box",
          overflow: "hidden",
          borderRadius: exportMode ? 0 : 20,
          position: "relative",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: exportMode ? 28 : "1.2em" }}>
          <div
            style={{
              width: exportMode ? 120 : "3.5em",
              height: exportMode ? 120 : "3.5em",
              borderRadius: "9999px",
              border: `1px solid ${t.border}`,
              backgroundColor: t.avatarBg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 600,
              fontSize: exportMode ? 48 : "1.6em",
              color: t.fg,
              letterSpacing: "-0.02em",
              overflow: "hidden",
            }}
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
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
          <div style={{ display: "flex", flexDirection: "column", gap: exportMode ? 10 : "0.35em" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: exportMode ? 14 : "0.28em",
                fontSize: exportMode ? 64 : "2em",
                fontWeight: 700,
                letterSpacing: "-0.03em",
                lineHeight: 1.1,
                color: t.fg,
              }}
            >
              <span>{name || "Your Name"}</span>
              <VerificationBadge tier={verificationTier} size={exportMode ? 44 : 18} exportMode={exportMode} />
            </div>
            {title ? (
              <div
                style={{
                  fontSize: exportMode ? 32 : "1em",
                  color: t.muted,
                  letterSpacing: "-0.01em",
                }}
              >
                {title}
              </div>
            ) : null}
          </div>
        </div>

        <div
          style={{
            fontSize: exportMode ? 44 : "1.35em",
            lineHeight: 1.4,
            color: t.body,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: "60%",
            overflow: "hidden",
          }}
        >
          {content || "Write something worth reading."}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: exportMode ? 40 : "1.2em",
            borderTop: `1px solid ${t.border}`,
          }}
        >
          <div
            style={{
              fontSize: exportMode ? 26 : "0.85em",
              color: t.muted,
              letterSpacing: "0.02em",
            }}
          >
            {handle ? (handle.startsWith("@") ? handle : `@${handle}`) : ""}
          </div>
          <div style={{ display: "flex", gap: exportMode ? 28 : "0.9em", color: t.muted }}>
            <Github size={exportMode ? 36 : 18} strokeWidth={1.75} />
            <Linkedin size={exportMode ? 36 : 18} strokeWidth={1.75} />
            <Twitter size={exportMode ? 36 : 18} strokeWidth={1.75} />
          </div>
        </div>

        {watermark ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: exportMode ? 48 : "1.4em",
              textAlign: "center",
              fontSize: exportMode ? 22 : "0.65em",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: t.muted,
              opacity: 0.55,
              pointerEvents: "none",
            }}
          >
            via The Ledger
          </div>
        ) : null}
      </div>
    );
  },
);

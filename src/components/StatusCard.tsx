import { forwardRef } from "react";
import { Github, Linkedin, Twitter } from "lucide-react";

export type Background = "noir" | "cream";

export type StatusCardProps = {
  name: string;
  title?: string;
  content: string;
  handle?: string;
  avatarUrl?: string | null;
  background?: Background;
  exportMode?: boolean;
};

const THEMES = {
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
} satisfies Record<Background, Record<string, string>>;

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
          backgroundImage: `radial-gradient(${t.dot} 1px, transparent 1px)`,
          backgroundSize: exportMode ? "44px 44px" : "22px 22px",
          color: t.fg,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          boxSizing: "border-box",
          overflow: "hidden",
          borderRadius: exportMode ? 0 : 20,
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
                fontSize: exportMode ? 64 : "2em",
                fontWeight: 700,
                letterSpacing: "-0.03em",
                lineHeight: 1.1,
                color: t.fg,
              }}
            >
              {name || "Your Name"}
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
      </div>
    );
  },
);

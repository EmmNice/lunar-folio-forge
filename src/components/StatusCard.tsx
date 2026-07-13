import { forwardRef } from "react";
import { Github, Linkedin, Twitter } from "lucide-react";

export type StatusCardProps = {
  name: string;
  title: string;
  content: string;
  handle?: string;
  /** Render at export resolution (1080x1920) when true; otherwise a responsive preview. */
  exportMode?: boolean;
};

/**
 * Uses explicit hex colors (no oklch/CSS vars) so html-to-image can rasterize
 * it reliably. Fonts are inlined via the Google Fonts link in __root.tsx.
 */
export const StatusCard = forwardRef<HTMLDivElement, StatusCardProps>(
  function StatusCard({ name, title, content, handle = "@godson", exportMode = false }, ref) {
    const styles: React.CSSProperties = exportMode
      ? {
          width: 1080,
          height: 1920,
          padding: "160px 110px",
          fontSize: 32,
        }
      : {
          aspectRatio: "1080 / 1920",
          width: "100%",
          padding: "9% 7%",
        };

    return (
      <div
        ref={ref}
        style={{
          ...styles,
          backgroundColor: "#0b0b0c",
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)",
          backgroundSize: exportMode ? "44px 44px" : "22px 22px",
          color: "#ffffff",
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
        {/* Header */}
        <div style={{ display: "flex", flexDirection: "column", gap: exportMode ? 28 : "1.2em" }}>
          <div
            style={{
              width: exportMode ? 120 : "3.5em",
              height: exportMode ? 120 : "3.5em",
              borderRadius: "9999px",
              border: "1px solid #1f2937",
              backgroundColor: "#111214",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 600,
              fontSize: exportMode ? 48 : "1.6em",
              color: "#ffffff",
              letterSpacing: "-0.02em",
            }}
          >
            {name.trim().charAt(0).toUpperCase() || "•"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: exportMode ? 10 : "0.35em" }}>
            <div
              style={{
                fontSize: exportMode ? 64 : "2em",
                fontWeight: 700,
                letterSpacing: "-0.03em",
                lineHeight: 1.1,
                color: "#ffffff",
              }}
            >
              {name || "Your Name"}
            </div>
            <div
              style={{
                fontSize: exportMode ? 32 : "1em",
                color: "#94a3b8",
                letterSpacing: "-0.01em",
              }}
            >
              {title || "Your Title"}
            </div>
          </div>
        </div>

        {/* Body */}
        <div
          style={{
            fontSize: exportMode ? 44 : "1.35em",
            lineHeight: 1.4,
            color: "#e5e7eb",
            fontWeight: 500,
            letterSpacing: "-0.02em",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            flex: exportMode ? "0 1 auto" : "0 1 auto",
            maxHeight: "60%",
            overflow: "hidden",
          }}
        >
          {content || "Write something worth reading."}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: exportMode ? 40 : "1.2em",
            borderTop: "1px solid #1f2937",
          }}
        >
          <div
            style={{
              fontSize: exportMode ? 26 : "0.85em",
              color: "#94a3b8",
              letterSpacing: "0.02em",
            }}
          >
            {handle}
          </div>
          <div style={{ display: "flex", gap: exportMode ? 28 : "0.9em", color: "#94a3b8" }}>
            <Github size={exportMode ? 36 : 18} strokeWidth={1.75} />
            <Linkedin size={exportMode ? 36 : 18} strokeWidth={1.75} />
            <Twitter size={exportMode ? 36 : 18} strokeWidth={1.75} />
          </div>
        </div>
      </div>
    );
  },
);

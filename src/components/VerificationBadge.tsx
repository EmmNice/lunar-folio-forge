import { BadgeCheck } from "lucide-react";

export type VerificationTier = "none" | "silver" | "gold";

export function VerificationBadge({
  tier,
  size = 14,
  exportMode = false,
}: {
  tier: VerificationTier | null | undefined;
  size?: number;
  exportMode?: boolean;
}) {
  if (!tier || tier === "none") return null;

  if (tier === "gold") {
    return (
      <span
        title="Elite Founder — Gold Verified"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          filter: exportMode
            ? "drop-shadow(0 0 6px rgba(250,204,21,0.85)) drop-shadow(0 0 2px rgba(250,204,21,0.9))"
            : "drop-shadow(0 0 4px rgba(250,204,21,0.65))",
        }}
      >
        <BadgeCheck
          width={size}
          height={size}
          style={{ color: "#facc15" }}
          fill="#3a2f05"
          strokeWidth={1.75}
        />
      </span>
    );
  }

  return (
    <span
      title="Recognized Builder — Silver Verified"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        filter: "drop-shadow(0 0 3px rgba(203,213,225,0.55))",
      }}
    >
      <BadgeCheck
        width={size}
        height={size}
        style={{ color: "#cbd5e1" }}
        fill="#2a2f38"
        strokeWidth={1.75}
      />
    </span>
  );
}

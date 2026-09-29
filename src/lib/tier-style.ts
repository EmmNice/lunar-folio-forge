/**
 * How a verification tier is expressed visually, in one place.
 *
 * Gold is the platform's scarcest signal — it means Gold Verified. It was also
 * being used as ordinary chrome: the fallback avatar was amber-tinted with an amber
 * initial for *every* member, the compose button was solid amber, and the profile
 * cover was an amber wash on everyone's own page. On a dark UI where amber is the
 * only saturated colour, that had two costs. It devalued the badge, because the
 * thing that marks out a verified member was the same colour as the New Post button.
 * And on an unverified account it was simply untrue: the interface presented
 * gold-tier styling to someone who had earned none of it.
 *
 * So: identity surfaces derive their colour from the member's actual tier, and
 * generic actions use the neutral primary. An unverified member now sees a neutral
 * interface, a Silver member sees slate, and gold means what it says.
 *
 * The brand mark keeps its single amber bar. That is the product's colour, not a
 * claim about the person looking at it.
 */

export type Tier = "none" | "silver" | "gold" | null | undefined;

export type TierVisual = {
  /** Ring around an avatar. */
  ring: string;
  /** Avatar background when there is no image to show. */
  fill: string;
  /** The initial letter, and small accents that belong to this identity. */
  ink: string;
  /** A faint background wash for panels tied to this member. */
  wash: string;
  /** Border for those panels. */
  edge: string;
  /** Profile cover band. */
  cover: string;
};

const NEUTRAL: TierVisual = {
  ring: "rgba(255,255,255,0.14)",
  fill: "rgba(255,255,255,0.07)",
  ink: "var(--text-secondary)",
  wash: "rgba(255,255,255,0.04)",
  edge: "rgba(255,255,255,0.08)",
  cover:
    "linear-gradient(135deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.018) 60%, rgba(255,255,255,0.01) 100%)",
};

const SILVER: TierVisual = {
  ring: "rgba(203,213,225,0.65)",
  fill: "rgba(203,213,225,0.12)",
  ink: "#cbd5e1",
  wash: "rgba(203,213,225,0.06)",
  edge: "rgba(203,213,225,0.18)",
  cover:
    "linear-gradient(135deg, rgba(203,213,225,0.14) 0%, rgba(203,213,225,0.03) 60%, rgba(255,255,255,0.015) 100%)",
};

const GOLD: TierVisual = {
  ring: "rgba(251,191,36,0.80)",
  fill: "rgba(251,191,36,0.16)",
  ink: "var(--gold)",
  wash: "rgba(251,191,36,0.07)",
  edge: "rgba(251,191,36,0.22)",
  cover:
    "linear-gradient(135deg, rgba(251,191,36,0.18) 0%, rgba(251,191,36,0.04) 60%, rgba(255,255,255,0.02) 100%)",
};

export function tierVisual(tier: Tier): TierVisual {
  if (tier === "gold") return GOLD;
  if (tier === "silver") return SILVER;
  return NEUTRAL;
}

/**
 * The neutral primary action colour.
 *
 * Exported so the compose buttons stop reaching for amber. A core action should not
 * change colour according to who is looking at it, and it should not borrow the
 * badge's colour to look important.
 */
export const ACTION_SURFACE = "#F5F5F6";
export const ACTION_INK = "#0B0B0C";

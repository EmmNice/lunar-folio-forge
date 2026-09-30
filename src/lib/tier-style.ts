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

/**
 * How the primary action chrome — compose button, active tab — is coloured.
 *
 * The note above still holds for the case it was written about: the compose button
 * used to be amber for *everybody*, which both devalued the badge and told an
 * unverified member something untrue about themselves. Neutral was the right fix.
 *
 * This is the narrower thing the owner asked for: a Gold member, and only a Gold
 * member, gets gold chrome. That does not reintroduce the original bug. The colour
 * is now earned rather than default, so it makes a true claim about whoever is
 * looking at it, and it is the tier doing the talking — the same principle the
 * identity surfaces above already follow.
 *
 * Silver stays neutral on purpose, and not for lack of a swatch. Silver is
 * #cbd5e1; against a #F5F5F6 button on near-black it is a barely perceptible
 * change, so tinting it would buy nothing visible while making the one real
 * distinction — gold or not — harder to read. Unverified stays neutral because it
 * has earned nothing.
 */
export type TierAction = {
  /** Filled-button background. */
  surface: string;
  /** Text/icon on top of `surface`. */
  ink: string;
  /** Accent for chrome drawn *on* the page background: active tab bar, underline. */
  accent: string;
  /**
   * Selected-segment background in the Signal/Beat/Following control.
   *
   * A tint rather than a solid fill, deliberately. Solid gold works on the compose
   * button because that button is one small circle and the loudest thing on the
   * screen by design. Three tabs in a sticky header are not that: a solid gold
   * segment there would out-shout the compose button and flatten the hierarchy
   * between "the thing you press to write" and "which list you are reading". The
   * tint keeps the raised-dark-pill shape the control already has and lets the
   * gold ink carry the signal.
   */
  chipSurface: string;
  /** Selected-segment label and icon. */
  chipInk: string;
};

const NEUTRAL_ACTION: TierAction = {
  surface: ACTION_SURFACE,
  ink: ACTION_INK,
  accent: "var(--foreground)",
  chipSurface: "var(--surface-3)",
  chipInk: "var(--foreground)",
};

const GOLD_ACTION: TierAction = {
  surface: "var(--gold)",
  // #fbbf24 is a light amber; it needs the dark ink, not white.
  ink: ACTION_INK,
  accent: "var(--gold)",
  // Stronger than tierVisual().wash (0.07), which is tuned for large panels and
  // would leave a selected tab barely distinguishable from an unselected one.
  chipSurface: "rgba(251,191,36,0.18)",
  chipInk: "var(--gold)",
};

export function tierAction(tier: Tier): TierAction {
  return tier === "gold" ? GOLD_ACTION : NEUTRAL_ACTION;
}

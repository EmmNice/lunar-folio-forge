import type { RoleType } from "@/hooks/use-auth";

/** Display label for each role, used on profiles, onboarding and the admin panel. */
export const ROLE_LABEL: Record<RoleType, string> = {
  founder: "Startup Founder",
  developer: "Core Developer",
  pm: "Technical PM",
  investor: "VC / Investor",
  // Added alongside the widened role_type CHECK (20260930000200). A designer or an
  // SRE previously had to describe themselves as a "Core Developer", which is the
  // sort of small dishonesty that makes a profile feel like a form.
  designer: "Product Designer",
  devops: "DevOps / SRE",
  data: "Data / ML Engineer",
  security: "Security Engineer",
  student: "Student / Learning",
};

/** Role picker options, in the order we want them presented. */
export const ROLE_OPTIONS: { value: RoleType; label: string }[] = (
  [
    "founder",
    "developer",
    "designer",
    "devops",
    "data",
    "security",
    "pm",
    "investor",
    "student",
  ] as const
).map((value) => ({ value, label: ROLE_LABEL[value] }));

/**
 * What someone is open to, shown as a badge on their profile.
 *
 * The first four are the platform's original founder-oriented signals and are
 * unchanged. The rest were added because a developer had no way to say any of this:
 * every existing option assumed you were raising money or looking for a co-founder.
 *
 * Keyed by the stored value, and looked up defensively at the call site — a value
 * added to the database CHECK without being added here should render nothing rather
 * than the raw enum.
 */
export const AVAILABILITY_LABEL: Record<string, string> = {
  open_to_angel: "Open to angel investment",
  raising_capital: "Raising capital",
  seeking_cofounder: "Looking for a co-founder",
  building_stealth: "Building in stealth",
  open_to_work: "Open to work",
  open_to_collab: "Open to collaborating",
  hiring: "Hiring",
  freelance: "Available for freelance",
};

/** Options for the availability picker, in presentation order. */
export const AVAILABILITY_OPTIONS: { value: string; label: string }[] = [
  "open_to_work",
  "open_to_collab",
  "freelance",
  "hiring",
  "seeking_cofounder",
  "raising_capital",
  "open_to_angel",
  "building_stealth",
].map((value) => ({ value, label: AVAILABILITY_LABEL[value] }));

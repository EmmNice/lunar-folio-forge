import type { RoleType } from "@/hooks/use-auth";

/** Display label for each role, used on profiles, onboarding and the admin panel. */
export const ROLE_LABEL: Record<RoleType, string> = {
  founder: "Startup Founder",
  developer: "Core Developer",
  pm: "Technical PM",
  investor: "VC / Investor",
};

/** Role picker options, in the order we want them presented. */
export const ROLE_OPTIONS: { value: RoleType; label: string }[] = (
  ["founder", "developer", "pm", "investor"] as const
).map((value) => ({ value, label: ROLE_LABEL[value] }));

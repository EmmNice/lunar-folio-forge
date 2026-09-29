import { MIN_PASSWORD_LENGTH } from "./limits";

/**
 * Client-side mirror of the project's Supabase password policy.
 *
 * Supabase enforces `password_min_length: 8` and
 * `password_required_characters: lower:upper:digit` (see
 * scripts/configure-supabase-auth.mjs). Without a matching check here the form
 * accepts a password, sends it, and surfaces the auth server's generic rejection
 * — which does not say which rule was missed. Worse, it fails *after* the member
 * has committed to the flow.
 *
 * Keep this in step with that script. If the two drift, the form is lying.
 */

export type PasswordRule = {
  label: string;
  satisfied: (value: string) => boolean;
};

export const PASSWORD_RULES: PasswordRule[] = [
  {
    label: `At least ${MIN_PASSWORD_LENGTH} characters`,
    satisfied: (v) => v.length >= MIN_PASSWORD_LENGTH,
  },
  { label: "A lowercase letter", satisfied: (v) => /[a-z]/.test(v) },
  { label: "An uppercase letter", satisfied: (v) => /[A-Z]/.test(v) },
  { label: "A number", satisfied: (v) => /[0-9]/.test(v) },
];

/** The first unmet requirement, or null when the password is acceptable. */
export function passwordProblem(value: string): string | null {
  const unmet = PASSWORD_RULES.find((rule) => !rule.satisfied(value));
  return unmet ? unmet.label : null;
}

export function passwordMeetsPolicy(value: string): boolean {
  return passwordProblem(value) === null;
}

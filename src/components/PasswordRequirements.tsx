import { Check } from "lucide-react";
import { PASSWORD_RULES } from "@/lib/password";

/**
 * Live checklist for the password policy.
 *
 * The signup form previously said "Password (8+ characters)" and left the rest of
 * the policy — which the auth server does enforce — for the member to discover by
 * being rejected. Showing the rules, and ticking them off as they are met, turns a
 * guessing game into a two-second task.
 */
export function PasswordRequirements({ value }: { value: string }) {
  if (!value) {
    return (
      <p className="field-hint">
        Needs {PASSWORD_RULES.length} things:{" "}
        {PASSWORD_RULES.map((r) => r.label.toLowerCase()).join(", ")}.
      </p>
    );
  }

  return (
    <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5" aria-label="Password requirements">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.satisfied(value);
        return (
          <li key={rule.label} className="flex items-center gap-1.5 text-[11px] leading-tight">
            <span
              className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full transition-colors"
              style={{
                background: met ? "rgba(74,222,128,0.16)" : "rgba(255,255,255,0.05)",
                color: met ? "var(--success)" : "var(--text-tertiary)",
              }}
            >
              {met ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
            </span>
            <span style={{ color: met ? "var(--text-secondary)" : "var(--text-tertiary)" }}>
              {rule.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

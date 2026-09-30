import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * A password input you can read back.
 *
 * Every password field in the app was a bare `type="password"` with no way to see
 * what had been typed. That is worth fixing rather than tolerating: on a phone
 * keyboard, with autocorrect and a cramped layout, a mistyped password is common
 * and invisible, and the only feedback is a failed sign-in that says nothing about
 * which character went wrong. It matters most on the screens where the stakes are
 * highest — choosing a new password, or confirming it twice.
 *
 * Hidden by default, because the reveal is for when somebody wants it, not a
 * decision made on their behalf in a public place.
 *
 * `autoComplete` is required rather than optional. Browsers and password managers
 * behave badly without it — a "new password" field treated as "current password"
 * gets autofilled with the old one — and leaving it to each caller is how that
 * happens. Passing it explicitly forces the decision at every call site.
 */
export function PasswordField({
  value,
  onChange,
  autoComplete,
  placeholder = "Password",
  className,
  required,
  disabled,
  autoFocus,
  minLength,
  id,
  name,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  minLength?: number;
  id?: string;
  name?: string;
  ariaLabel?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        /*
          Switching the type is what actually reveals the characters. It also drops
          the field out of the browser's password-manager heuristics while visible,
          which is why the type flips back the moment it is hidden again rather than
          staying `text`.
        */
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        minLength={minLength}
        aria-label={ariaLabel}
        // Room on the right for the toggle, so a long password does not run under it.
        className={`${className ?? ""} pr-11`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        // tabIndex -1: tabbing from the password field should reach the submit
        // button, not detour through a control that only changes how it looks.
        tabIndex={-1}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        disabled={disabled}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

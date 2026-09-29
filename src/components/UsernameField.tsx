import { useEffect, useRef, useState } from "react";
import { AtSign, Check, Loader2, X } from "lucide-react";
import {
  checkUsername,
  slugifyUsername,
  USERNAME_HINT,
  USERNAME_MIN,
  type UsernameState,
} from "@/lib/username";

/**
 * Username input with live availability.
 *
 * One component for all three places a username is chosen — signup, onboarding and
 * the rename screen — because the rules and the copy have to match in all of them,
 * and the previous arrangement (an ad-hoc check inlined in onboarding, nothing at
 * signup) is how signup ended up with no username at all.
 *
 * Reports state upward via `onStateChange` so the parent can disable its submit
 * button. The parent must still handle a rejection on submit: availability is
 * advisory and two people can pass this check at the same moment.
 */
export function UsernameField({
  value,
  onChange,
  onStateChange,
  autoFocus = false,
  disabled = false,
  label = "Username",
  /** Skip the check when the value equals the member's current handle. */
  currentHandle,
}: {
  value: string;
  onChange: (next: string) => void;
  onStateChange?: (state: UsernameState) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  label?: string;
  currentHandle?: string;
}) {
  const [state, setState] = useState<UsernameState>({ status: "empty" });
  const seq = useRef(0);

  useEffect(() => {
    const slug = slugifyUsername(value);

    // Their own current name is neither taken nor a change.
    if (currentHandle && slug === currentHandle) {
      const next: UsernameState = { status: "available" };
      setState(next);
      onStateChange?.(next);
      return;
    }

    if (slug.length === 0) {
      const next: UsernameState = { status: "empty" };
      setState(next);
      onStateChange?.(next);
      return;
    }
    if (slug.length < USERNAME_MIN) {
      const next: UsernameState = { status: "too-short" };
      setState(next);
      onStateChange?.(next);
      return;
    }

    setState({ status: "checking" });
    onStateChange?.({ status: "checking" });

    // Debounced, and sequence-guarded: without the guard a slow answer for an
    // earlier keystroke can land after a fast answer for a later one and label the
    // wrong name as taken.
    const mine = (seq.current += 1);
    const timer = setTimeout(async () => {
      const result = await checkUsername(slug);
      if (mine !== seq.current) return;
      setState(result);
      onStateChange?.(result);
    }, 350);

    return () => clearTimeout(timer);
    // onStateChange is intentionally excluded: parents pass an inline closure, and
    // including it would re-run the check on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, currentHandle]);

  const slug = slugifyUsername(value);

  return (
    <div className="space-y-1.5">
      <label
        htmlFor="username"
        className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary"
      >
        {label}
      </label>

      <div className="relative">
        <AtSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary" />
        <input
          id="username"
          name="username"
          type="text"
          inputMode="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          /* Slugified on the way in, so what is shown is exactly what will be
             stored — no surprise transformation between typing and saving. */
          onChange={(e) => onChange(slugifyUsername(e.target.value))}
          placeholder="yourname"
          aria-describedby="username-hint"
          aria-invalid={state.status === "unavailable" || state.status === "too-short"}
          className="field w-full !pl-9 !pr-9"
          maxLength={20}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2">
          {state.status === "checking" ? (
            <Loader2 className="h-4 w-4 animate-spin text-tertiary" />
          ) : state.status === "available" ? (
            <Check className="h-4 w-4 text-emerald-400" />
          ) : state.status === "unavailable" ? (
            <X className="h-4 w-4 text-red-400" />
          ) : null}
        </span>
      </div>

      <p id="username-hint" className="text-[11px] leading-relaxed">
        {state.status === "unavailable" ? (
          <span className="text-red-400">{state.message}</span>
        ) : state.status === "too-short" ? (
          <span className="text-tertiary">{USERNAME_HINT}</span>
        ) : state.status === "available" && slug.length > 0 ? (
          <span className="text-emerald-400">
            {currentHandle && slug === currentHandle
              ? "Your current username."
              : `@${slug} is available.`}
          </span>
        ) : state.status === "error" ? (
          <span className="text-amber-400">
            Couldn&apos;t check that name. You can still try it.
          </span>
        ) : (
          <span className="text-tertiary">{USERNAME_HINT}</span>
        )}
      </p>
    </div>
  );
}

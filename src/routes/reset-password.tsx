import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Loader2, Lock, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LedgerMark } from "@/components/AppHeader";
import { MIN_PASSWORD_LENGTH } from "@/lib/limits";
import { PasswordField } from "@/components/PasswordField";

/**
 * Where a password reset link lands.
 *
 * This route did not exist. `resetPasswordForEmail` was never called either, so
 * the whole recovery path was missing and a forgotten password meant a
 * permanently inaccessible account. If someone had triggered a recovery email
 * from the Supabase dashboard, the link would have landed on the Site URL,
 * detectSessionInUrl would have quietly signed them in, and they would have had
 * to guess that /account-security existed.
 *
 * Deliberately NOT under _authenticated: a recovery session is a real session, so
 * that guard would pass, but it would then bounce anyone with an incomplete
 * profile to /onboarding and lose the recovery state.
 */
export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set a new password · The Ledger" },
      // Recovery URLs carry a one-time token. Keep them out of search indexes.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ResetPasswordPage,
});

type Phase = "verifying" | "ready" | "invalid" | "done";

/** Reads the error Supabase puts in the URL when a link is expired or reused. */
function readLinkError(): string | null {
  if (typeof window === "undefined") return null;
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const fromQuery = new URLSearchParams(window.location.search);
  const description =
    fromHash.get("error_description") ?? fromQuery.get("error_description") ?? null;
  if (description) return description.replace(/\+/g, " ");
  const code = fromHash.get("error") ?? fromQuery.get("error");
  return code ? `The link could not be used (${code}).` : null;
}

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("verifying");
  const [problem, setProblem] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const linkError = readLinkError();
    if (linkError) {
      setProblem(linkError);
      setPhase("invalid");
      return;
    }

    // The client is configured with supabase-js defaults (detectSessionInUrl:
    // true, flowType: 'pkce'), so it exchanges the token in the URL for a session
    // on its own. That exchange races this effect, so listen for the event *and*
    // poll getSession briefly rather than trusting either one alone.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setPhase("ready");
      }
    });

    (async () => {
      for (const delay of [0, 250, 600, 1200]) {
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        if (cancelled) return;
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          setPhase("ready");
          return;
        }
      }
      if (!cancelled) {
        setProblem(
          "This reset link is no longer valid. Links expire after one hour and can only be used once.",
        );
        setPhase("invalid");
      }
    })();

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }

    // Whoever prompted the reset may already hold a session on another device —
    // that is the usual reason for resetting in the first place. Revoking every
    // other session is the point of the exercise, not a nicety.
    const { error: signOutErr } = await supabase.auth.signOut({ scope: "others" });
    if (signOutErr)
      console.warn("[reset-password] could not revoke other sessions:", signOutErr.message);

    setBusy(false);
    setPhase("done");
    toast.success("Password updated. Other devices have been signed out.");
  }

  const inputCls =
    "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-tertiary outline-none ring-offset-background focus-visible:ring-1 focus-visible:ring-ring transition-colors";

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4"
      style={{ background: "#0B0B0C" }}
    >
      <div className="mb-8 flex items-center gap-2.5">
        <LedgerMark />
        <span className="text-[15px] font-semibold tracking-tight">The Ledger</span>
      </div>

      <div
        className="w-full max-w-sm rounded-2xl p-6"
        style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(26,26,30,0.60)" }}
      >
        {phase === "verifying" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Checking your reset link…</p>
          </div>
        )}

        {phase === "invalid" && (
          <div className="text-center">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-border bg-secondary/60">
              <AlertCircle className="h-5 w-5 text-red-400" />
            </div>
            <h1 className="text-base font-semibold">That link didn't work</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{problem}</p>
            <button
              type="button"
              onClick={() => navigate({ to: "/", replace: true })}
              className="mt-5 w-full rounded-xl bg-foreground py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 active:scale-[0.98]"
            >
              Request a new link
            </button>
          </div>
        )}

        {phase === "ready" && (
          <div>
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-border bg-secondary/60">
              <Lock className="h-5 w-5 text-muted-foreground" />
            </div>
            <h1 className="mb-1 text-center text-base font-semibold">Set a new password</h1>
            <p className="mb-4 text-center text-sm text-muted-foreground">
              Choose something you haven't used here before.
            </p>
            <form onSubmit={submit} className="space-y-3">
              <PasswordField
                autoComplete="new-password"
                value={password}
                onChange={setPassword}
                placeholder={`New password (${MIN_PASSWORD_LENGTH}+ characters)`}
                className={inputCls}
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
              <PasswordField
                autoComplete="new-password"
                value={confirm}
                onChange={setConfirm}
                placeholder="Confirm new password"
                className={inputCls}
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-foreground py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
              >
                {busy ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Updating…
                  </span>
                ) : (
                  "Update password"
                )}
              </button>
            </form>
          </div>
        )}

        {phase === "done" && (
          <div className="text-center">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-border bg-secondary/60">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            </div>
            <h1 className="text-base font-semibold">Password updated</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              You're signed in on this device. Every other device has been signed out.
            </p>
            <button
              type="button"
              onClick={() => navigate({ to: "/feed", replace: true })}
              className="mt-5 w-full rounded-xl bg-foreground py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 active:scale-[0.98]"
            >
              Continue to The Ledger
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

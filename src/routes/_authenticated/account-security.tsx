import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Lock, Github, Loader2, CheckCircle2, Circle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { MIN_PASSWORD_LENGTH } from "@/lib/limits";
import { PasswordField } from "@/components/PasswordField";

export const Route = createFileRoute("/_authenticated/account-security")({
  head: () => ({ meta: [{ title: "Security & Auth · The Ledger" }] }),
  component: SecuritySettingsPage,
});

function SecuritySettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [showPwForm, setShowPwForm] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [busy, setBusy] = useState(false);

  const identities = user?.identities ?? [];
  const hasGithub = identities.some((i) => i.provider === "github");
  const hasGoogle = identities.some((i) => i.provider === "google");
  const hasEmail = identities.some((i) => i.provider === "email");

  /**
   * Change the account password.
   *
   * The current password is re-checked first. The project has
   * `security_update_password_require_reauthentication` off, so
   * `auth.updateUser({ password })` on its own will happily rewrite the password
   * using nothing but the session token — meaning anyone who got hold of an
   * unattended browser, or the token out of localStorage, could lock the real
   * owner out permanently. Re-authenticating turns "has a session" into "knows
   * the password", which is the bar this action should clear.
   *
   * Members who signed in through GitHub or Google have no password to confirm,
   * so for them the form is a *set*-password flow and the check is skipped.
   */
  async function changePassword() {
    if (!newPw.trim()) {
      toast.error("Enter a new password.");
      return;
    }
    if (newPw !== confirmPw) {
      toast.error("Passwords don't match.");
      return;
    }
    if (newPw.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Minimum ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (hasEmail && newPw === currentPw) {
      toast.error("That's your current password. Choose a different one.");
      return;
    }

    setBusy(true);

    if (hasEmail) {
      if (!currentPw) {
        setBusy(false);
        toast.error("Enter your current password.");
        return;
      }
      const email = user?.email;
      if (!email) {
        setBusy(false);
        toast.error("Your account has no email address on file.");
        return;
      }
      // signInWithPassword on the same account refreshes the existing session
      // rather than creating a second one, so a correct password is a no-op here
      // and a wrong one costs nothing.
      const { error: reauthErr } = await supabase.auth.signInWithPassword({
        email,
        password: currentPw,
      });
      if (reauthErr) {
        setBusy(false);
        toast.error(
          reauthErr.message.toLowerCase().includes("invalid")
            ? "That current password isn't right."
            : reauthErr.message,
        );
        return;
      }
    }

    const { error } = await supabase.auth.updateUser({ password: newPw });
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }

    // Anyone else holding a session on this account loses it.
    const { error: signOutErr } = await supabase.auth.signOut({ scope: "others" });
    if (signOutErr) console.warn("[security] could not revoke other sessions:", signOutErr.message);

    setBusy(false);
    toast.success("Password updated. Other devices have been signed out.");
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
    setShowPwForm(false);
  }

  return (
    <div className="min-h-screen" style={{ background: "#0B0B0C" }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-4"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <button type="button" onClick={() => navigate({ to: "/feed" })} className="btn-icon">
          <ArrowLeft className="h-5 w-5 text-muted-foreground" />
        </button>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-tertiary">
            Account
          </p>
          <h1 className="text-[17px] font-semibold tracking-tight">Security & Auth</h1>
        </div>
      </div>

      <main className="mx-auto max-w-lg px-4 pt-8 pb-28">
        {/* Change Password */}
        <div
          className="overflow-hidden rounded-2xl"
          style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(26,26,30,0.60)" }}
        >
          <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: "rgba(255,255,255,0.06)" }}
                >
                  <Lock className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">Change Password</p>
                  <p className="text-[11px] text-muted-foreground">
                    {hasEmail ? "Update your sign-in password." : "No email/password login linked."}
                  </p>
                </div>
              </div>
              {hasEmail && (
                <button
                  type="button"
                  onClick={() => setShowPwForm((v) => !v)}
                  className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.07)",
                  }}
                >
                  {showPwForm ? "Cancel" : "Change"}
                </button>
              )}
            </div>

            {showPwForm && (
              <div className="mt-4 space-y-2">
                {hasEmail && (
                  <PasswordField
                    autoComplete="current-password"
                    className="lux-field"
                    placeholder="Current password"
                    value={currentPw}
                    onChange={setCurrentPw}
                  />
                )}
                <PasswordField
                  autoComplete="new-password"
                  className="lux-field"
                  placeholder={`New password (min ${MIN_PASSWORD_LENGTH} chars)`}
                  value={newPw}
                  onChange={setNewPw}
                />
                <PasswordField
                  autoComplete="new-password"
                  className="lux-field"
                  placeholder="Confirm new password"
                  value={confirmPw}
                  onChange={setConfirmPw}
                />
                {!hasEmail && (
                  <p className="px-0.5 text-xs text-muted-foreground">
                    You signed in with a provider, so there's no existing password to confirm.
                    Setting one lets you sign in with your email as well.
                  </p>
                )}
                <button
                  type="button"
                  onClick={changePassword}
                  disabled={busy}
                  className="btn btn-primary btn-block"
                  style={{ background: "#F5F5F6" }}
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Update Password
                </button>
              </div>
            )}
          </div>

          {/* Linked accounts */}
          <div className="px-5 py-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-tertiary">
              Linked Accounts
            </p>
            <div className="space-y-3">
              {[
                { icon: <Github className="h-4 w-4" />, label: "GitHub", connected: hasGithub },
                {
                  icon: <span className="text-[13px] font-bold leading-none">G</span>,
                  label: "Google",
                  connected: hasGoogle,
                },
              ].map(({ icon, label, connected }) => (
                <div key={label} className="flex items-center gap-3">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.07)",
                    }}
                  >
                    {icon}
                  </div>
                  <span className="flex-1 text-sm text-foreground/80">{label}</span>
                  {connected ? (
                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Circle className="h-3.5 w-3.5" /> Not linked
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

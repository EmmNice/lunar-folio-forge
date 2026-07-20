import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft, Lock, Github, Loader2, CheckCircle2, Circle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/account-security")({
  head: () => ({ meta: [{ title: "Security & Auth · The Ledger" }] }),
  component: SecuritySettingsPage,
});

function SecuritySettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [showPwForm, setShowPwForm] = useState(false);
  const [newPw, setNewPw]           = useState("");
  const [confirmPw, setConfirmPw]   = useState("");
  const [busy, setBusy]             = useState(false);

  const identities = user?.identities ?? [];
  const hasGithub  = identities.some((i) => i.provider === "github");
  const hasGoogle  = identities.some((i) => i.provider === "google");
  const hasEmail   = identities.some((i) => i.provider === "email");

  async function changePassword() {
    if (!newPw.trim()) { toast.error("Enter a new password."); return; }
    if (newPw !== confirmPw) { toast.error("Passwords don't match."); return; }
    if (newPw.length < 8) { toast.error("Minimum 8 characters."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Password updated.");
    setNewPw(""); setConfirmPw(""); setShowPwForm(false);
  }

  return (
    <div className="min-h-screen" style={{ background: "#0B0B0C" }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-4"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <button
          type="button"
          onClick={() => navigate({ to: "/feed" })}
          className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors hover:bg-white/[0.06]"
        >
          <ArrowLeft className="h-5 w-5 text-muted-foreground" />
        </button>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
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
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  {showPwForm ? "Cancel" : "Change"}
                </button>
              )}
            </div>

            {showPwForm && (
              <div className="mt-4 space-y-2">
                <input
                  type="password"
                  className="lux-field"
                  placeholder="New password (min 8 chars)"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                />
                <input
                  type="password"
                  className="lux-field"
                  placeholder="Confirm new password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                />
                <button
                  type="button"
                  onClick={changePassword}
                  disabled={busy}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
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
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
              Linked Accounts
            </p>
            <div className="space-y-3">
              {[
                { icon: <Github className="h-4 w-4" />, label: "GitHub", connected: hasGithub },
                { icon: <span className="text-[13px] font-bold leading-none">G</span>, label: "Google", connected: hasGoogle },
              ].map(({ icon, label, connected }) => (
                <div key={label} className="flex items-center gap-3">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }}
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

import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Trash2, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { deleteAccount } from "@/lib/account.functions";
import { resetPerUserState } from "@/lib/session-reset";

export const Route = createFileRoute("/_authenticated/account-delete")({
  head: () => ({ meta: [{ title: "Delete account · The Ledger" }] }),
  component: DeleteAccountPage,
});

/** What actually goes, spelled out. Vague deletion copy is how people get surprised. */
const REMOVED = [
  "Your profile, username and avatar",
  "Every post, Studio card, comment and reply",
  "Your likes, re-ships, saved posts and pinned projects",
  "Your follows, followers, blocks and mutes",
  "Your direct messages and notifications",
];

function DeleteAccountPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();
  const remove = useServerFn(deleteAccount);

  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const handle = profile?.handle ?? "";
  const matches = confirm.trim().toLowerCase() === handle.toLowerCase() && handle.length > 0;

  async function submit() {
    if (!matches) return;
    setBusy(true);
    try {
      await remove({ data: { confirmHandle: confirm.trim() } });
      // The account is gone, so the session is meaningless. Clear local state
      // before signing out so nothing from it survives into the next session.
      qc.clear();
      resetPerUserState();
      await supabase.auth.signOut({ scope: "local" });
      await router.invalidate();
      toast.success("Your account has been deleted.");
      navigate({ to: "/", replace: true });
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : "Couldn't delete your account.");
    }
  }

  return (
    <div className="min-h-screen" style={{ background: "#0B0B0C" }}>
      <div
        className="flex items-center gap-3 px-4 py-4"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <button
          type="button"
          onClick={() => router.history.back()}
          className="btn-icon"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5 text-muted-foreground" />
        </button>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-tertiary">
            Account
          </p>
          <h1 className="text-[17px] font-semibold tracking-tight">Delete account</h1>
        </div>
      </div>

      <main className="mx-auto max-w-lg px-4 pb-28 pt-8">
        <div
          className="flex items-start gap-3 rounded-2xl p-4"
          style={{
            border: "1px solid rgba(248,113,113,0.25)",
            background: "rgba(248,113,113,0.06)",
          }}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <div className="text-xs leading-relaxed">
            <p className="font-semibold text-red-300">This cannot be undone</p>
            <p className="mt-1 text-muted-foreground">
              There is no recovery window and no export. If you want a copy of anything you have
              written, save it before continuing.
            </p>
          </div>
        </div>

        <div
          className="mt-5 rounded-2xl p-5"
          style={{
            border: "1px solid rgba(255,255,255,0.07)",
            background: "rgba(26,26,30,0.60)",
          }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-tertiary">
            What gets deleted
          </p>
          <ul className="mt-3 space-y-1.5">
            {REMOVED.map((line) => (
              <li key={line} className="flex items-start gap-2 text-[13px] leading-relaxed">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-red-400/70" />
                <span className="text-secondary">{line}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-tertiary">
            Your username becomes available for someone else to register. Reports already filed
            about your content are kept for moderation records, without your profile attached.
          </p>
        </div>

        <div className="mt-5 space-y-2">
          <label htmlFor="confirm" className="block text-[12px] text-secondary">
            Type <span className="font-semibold text-foreground">{handle || "your username"}</span>{" "}
            to confirm
          </label>
          <input
            id="confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={handle}
            className="field w-full"
          />
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={!matches || busy}
          className="btn btn-block mt-4"
          style={{
            background: matches ? "rgba(248,113,113,0.14)" : "var(--surface-2)",
            border: `1px solid ${matches ? "rgba(248,113,113,0.40)" : "var(--border)"}`,
            color: matches ? "#fca5a5" : "var(--text-tertiary)",
          }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Delete my account permanently
        </button>
      </main>
    </div>
  );
}

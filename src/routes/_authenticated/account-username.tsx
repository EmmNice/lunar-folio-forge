import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, AtSign, Loader2, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { UsernameField } from "@/components/UsernameField";
import {
  describeUsernameError,
  slugifyUsername,
  USERNAME_MIN,
  type UsernameState,
} from "@/lib/username";

export const Route = createFileRoute("/_authenticated/account-username")({
  head: () => ({ meta: [{ title: "Username · The Ledger" }] }),
  component: UsernamePage,
});

/** Matches the database cooldown in guard_privileged_profile_columns. */
const COOLDOWN_DAYS = 30;

function nextChangeAllowedAt(handleChangedAt: string | null): Date | null {
  if (!handleChangedAt) return null;
  const next = new Date(handleChangedAt);
  next.setDate(next.getDate() + COOLDOWN_DAYS);
  return next > new Date() ? next : null;
}

function UsernamePage() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();

  const [value, setValue] = useState("");
  const [state, setState] = useState<UsernameState>({ status: "empty" });
  const [busy, setBusy] = useState(false);

  // Seeded from `profile` in an effect, not useState's initialiser. The initialiser
  // runs once, and `profile` arrives asynchronously — several settings screens in
  // this app get that wrong and render a stale value on a cold load.
  useEffect(() => {
    if (profile?.handle) setValue(profile.handle);
  }, [profile?.handle]);

  const current = profile?.handle ?? "";
  const slug = slugifyUsername(value);
  const lockedUntil = nextChangeAllowedAt(profile?.handle_changed_at ?? null);
  const unchanged = slug === current;

  const canSave =
    !!user &&
    !busy &&
    !lockedUntil &&
    !unchanged &&
    slug.length >= USERNAME_MIN &&
    state.status === "available";

  async function save() {
    if (!user || !canSave) return;
    setBusy(true);
    // Only `handle` is sent. The cooldown stamp is written by the database trigger,
    // so it cannot be reset from here.
    const { error } = await supabase
      .from("profiles")
      .update({ handle: slug })
      .eq("id", user.id)
      .select("handle")
      .maybeSingle();
    setBusy(false);

    if (error) {
      toast.error(describeUsernameError(error.message));
      return;
    }

    await refreshProfile();
    // Any /u/<old-handle> route currently in the router cache is now wrong.
    await router.invalidate();
    toast.success(`You're now @${slug}.`);
    navigate({ to: "/u/$handle", params: { handle: slug }, search: { tab: undefined } });
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
          <h1 className="text-[17px] font-semibold tracking-tight">Username</h1>
        </div>
      </div>

      <main className="mx-auto max-w-lg px-4 pb-28 pt-8">
        <div
          className="rounded-2xl p-5"
          style={{
            border: "1px solid rgba(255,255,255,0.07)",
            background: "rgba(26,26,30,0.60)",
          }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-tertiary">
            Current
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-lg font-semibold">
            <AtSign className="h-4 w-4 text-tertiary" />
            {current || "—"}
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-secondary">
            This is your address on The Ledger. People find you at{" "}
            <span className="text-foreground">/u/{slug || current || "yourname"}</span>, and it is
            what @mentions resolve to.
          </p>
        </div>

        {lockedUntil ? (
          <div
            className="mt-5 flex items-start gap-3 rounded-xl p-4"
            style={{
              border: "1px solid rgba(251,191,36,0.25)",
              background: "rgba(251,191,36,0.06)",
            }}
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="text-xs leading-relaxed">
              <p className="font-semibold text-amber-300">
                You&apos;ve changed your username recently
              </p>
              <p className="mt-1 text-muted-foreground">
                You can change it again on{" "}
                {lockedUntil.toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
                . The limit is once every {COOLDOWN_DAYS} days, which keeps usernames from being
                cycled to dodge a block or to squat names.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <UsernameField
              value={value}
              onChange={setValue}
              onStateChange={setState}
              currentHandle={current}
              disabled={busy}
              label="New username"
            />

            <div
              className="rounded-xl p-3 text-[11px] leading-relaxed text-muted-foreground"
              style={{ border: "1px dashed rgba(255,255,255,0.12)" }}
            >
              Changing this breaks existing links to{" "}
              <span className="text-secondary">/u/{current}</span>, and the old name becomes
              available for someone else to take. You can only change it once every {COOLDOWN_DAYS}{" "}
              days.
            </div>

            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              className="btn btn-primary btn-block"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {unchanged ? "Enter a new username" : `Change to @${slug || "…"}`}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

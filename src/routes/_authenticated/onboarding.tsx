import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { RoleType } from "@/hooks/use-auth";
import { ROLE_OPTIONS } from "@/lib/roles";
import { UsernameField } from "@/components/UsernameField";
import {
  describeUsernameError,
  slugifyUsername,
  USERNAME_MIN,
  type UsernameState,
} from "@/lib/username";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "Set up your profile · The Ledger" }] }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const { user, profile, loading, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [handle, setHandle] = useState("");
  const [dob, setDob] = useState("");
  const [roleType, setRoleType] = useState<RoleType | "">("");
  const [companyName, setCompanyName] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);

  const [usernameState, setUsernameState] = useState<UsernameState>({ status: "empty" });

  useEffect(() => {
    if (!loading && profile) {
      if (profile.onboarding_completed) {
        navigate({ to: "/feed", replace: true });
        return;
      }
      setFullName(profile.display_name ?? "");
      /*
        An OAuth signup arrives with a neutral placeholder handle (`dev_<hex>`)
        because there was no opportunity to ask for one. Prefilling it would invite
        people to keep a machine-generated identity, so the field starts empty and
        they have to choose. A handle they picked at signup is prefilled as normal.
        display_name gets the same treatment when it only mirrors the placeholder.
      */
      const generated = /^dev_[0-9a-f]{8}$/.test(profile.handle ?? "");
      setHandle(generated ? "" : (profile.handle ?? ""));
      if (generated && profile.display_name === profile.handle) setFullName("");
      setBio(profile.bio ?? "");
    }
  }, [loading, profile, navigate]);

  const minDob = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 13);
    return d.toISOString().slice(0, 10);
  })();

  const canSubmit =
    !!user &&
    fullName.trim().length > 0 &&
    slugifyUsername(handle).length >= USERNAME_MIN &&
    usernameState.status === "available" &&
    !!dob &&
    !!roleType &&
    companyName.trim().length > 0 &&
    bio.trim().length > 0;

  async function submit() {
    if (!user || !canSubmit) return;
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: fullName.trim(),
        handle: slugifyUsername(handle),
        date_of_birth: dob,
        role_type: roleType,
        company_name: companyName.trim(),
        bio: bio.trim(),
        onboarding_completed: true,
      })
      .eq("id", user.id);
    setBusy(false);
    if (!error) {
      // Bust the _authenticated/route.tsx sessionStorage cache so the next
      // navigation picks up the new onboarding_completed=true value.
      sessionStorage.removeItem(`ob:${user.id}`);
    }
    if (error) {
      toast.error(describeUsernameError(error.message));
      return;
    }
    await refreshProfile();
    toast.success("Welcome to The Ledger.");
    navigate({ to: "/feed", replace: true });
  }

  const field =
    "w-full rounded-md border border-border bg-secondary/40 px-3 py-2.5 text-sm text-foreground placeholder:text-tertiary outline-none transition-colors focus:border-foreground/40";

  // Progress tracking based on filled fields
  const steps = [
    {
      label: "Identity",
      done: fullName.trim().length > 0 && usernameState.status === "available",
    },
    { label: "Role", done: !!dob && !!roleType && companyName.trim().length > 0 },
    { label: "Your story", done: bio.trim().length > 0 },
  ];
  const completedCount = steps.filter((s) => s.done).length;

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-lg px-4 pb-24 pt-14 sm:px-6 page-enter">
        {/* Step progress indicator */}
        <div className="mb-8 flex items-center gap-3">
          {steps.map((step, i) => (
            <div key={step.label} className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold transition-all"
                  style={{
                    background: step.done
                      ? "rgba(245,245,246,0.90)"
                      : i === completedCount
                        ? "rgba(255,255,255,0.12)"
                        : "rgba(255,255,255,0.05)",
                    color: step.done ? "#0B0B0C" : i === completedCount ? "#F5F5F6" : "#6B6B7A",
                    border: step.done
                      ? "none"
                      : i === completedCount
                        ? "1px solid rgba(255,255,255,0.20)"
                        : "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  {step.done ? "✓" : i + 1}
                </div>
                <span
                  className="hidden text-[11px] font-medium sm:block"
                  style={{
                    color: step.done ? "#F5F5F6" : i === completedCount ? "#A0A0AA" : "#6B6B7A",
                  }}
                >
                  {step.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  className="h-px flex-1 transition-all"
                  style={{
                    background: step.done ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.08)",
                    width: "2rem",
                  }}
                />
              )}
            </div>
          ))}
        </div>

        <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
          One-time setup
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          Set up your Ledger profile
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This is a high-signal, professional network for tech founders and builders — a few real
          details before you can post or browse the feed.
        </p>

        <div className="mt-8 space-y-5">
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Full real name
            </label>
            <input
              className={field}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={60}
              placeholder="Aria Stone"
            />
          </div>

          <UsernameField
            value={handle}
            onChange={setHandle}
            onStateChange={setUsernameState}
            disabled={busy}
          />

          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Date of birth
            </label>
            <input
              type="date"
              className={field}
              value={dob}
              max={minDob}
              onChange={(e) => setDob(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Role type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ROLE_OPTIONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRoleType(r.value)}
                  className={
                    "rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors " +
                    (roleType === r.value
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:text-foreground")
                  }
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Company / startup name
            </label>
            <input
              className={field}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              maxLength={80}
              placeholder="Nimbus Cloud"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              One-sentence bio
            </label>
            <textarea
              rows={2}
              className={field + " resize-none"}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={200}
              placeholder="Building the boring infra everyone depends on."
            />
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit || busy}
            className="w-full rounded-md bg-foreground px-4 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Setting up…" : "Enter The Ledger"}
          </button>
        </div>
      </main>
    </div>
  );
}

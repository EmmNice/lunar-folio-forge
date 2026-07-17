import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { RoleType } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "Set up your profile · The Ledger" }] }),
  component: OnboardingPage,
});

const ROLE_OPTIONS: { value: RoleType; label: string }[] = [
  { value: "founder", label: "Startup Founder" },
  { value: "developer", label: "Core Developer" },
  { value: "pm", label: "Technical PM" },
  { value: "investor", label: "VC / Investor" },
];

function slugifyHandle(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
}

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

  const [handleStatus, setHandleStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!loading && profile) {
      if (profile.onboarding_completed) {
        navigate({ to: "/feed", replace: true });
        return;
      }
      setFullName(profile.display_name ?? "");
      setHandle(profile.handle ?? "");
      setBio(profile.bio ?? "");
    }
  }, [loading, profile, navigate]);

  useEffect(() => {
    if (checkTimer.current) clearTimeout(checkTimer.current);
    const h = slugifyHandle(handle);
    if (h.length < 2) {
      setHandleStatus("idle");
      return;
    }
    setHandleStatus("checking");
    checkTimer.current = setTimeout(async () => {
      // Don't run the check until the user session is confirmed
      if (!user?.id) { setHandleStatus("idle"); return; }
      const { data } = await supabase
        .from("profiles")
        .select("id")
        .eq("handle", h)
        .neq("id", user.id)
        .maybeSingle();
      setHandleStatus(data ? "taken" : "available");
    }, 400);
    return () => {
      if (checkTimer.current) clearTimeout(checkTimer.current);
    };
  }, [handle, user?.id]);

  const minDob = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 13);
    return d.toISOString().slice(0, 10);
  })();

  const canSubmit =
    !!user &&
    fullName.trim().length > 0 &&
    slugifyHandle(handle).length >= 2 &&
    handleStatus === "available" &&
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
        handle: slugifyHandle(handle),
        date_of_birth: dob,
        role_type: roleType,
        company_name: companyName.trim(),
        bio: bio.trim(),
        onboarding_completed: true,
      })
      .eq("id", user.id);
    setBusy(false);
    if (error) {
      toast.error(
        error.message.includes("profiles_handle_key") ? "That handle was just taken — try another." : error.message,
      );
      return;
    }
    await refreshProfile();
    toast.success("Welcome to The Ledger.");
    navigate({ to: "/feed", replace: true });
  }

  const field =
    "w-full rounded-md border border-border bg-secondary/40 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-foreground/40";

  // Progress tracking based on filled fields
  const steps = [
    { label: "Identity",  done: fullName.trim().length > 0 && handleStatus === "available" },
    { label: "Role",      done: !!dob && !!roleType && companyName.trim().length > 0 },
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
                  style={{ color: step.done ? "#F5F5F6" : i === completedCount ? "#A0A0AA" : "#6B6B7A" }}
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
          This is a high-signal, professional network for tech founders and builders — a few
          real details before you can post or browse the feed.
        </p>

        <div className="mt-8 space-y-5">
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Full real name</label>
            <input className={field} value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={60} placeholder="Aria Stone" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Tech name / handle</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
              <input
                className={field + " pl-6 pr-9"}
                value={handle}
                onChange={(e) => setHandle(slugifyHandle(e.target.value))}
                maxLength={20}
                placeholder="ariastone"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2">
                {handleStatus === "checking" ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : handleStatus === "available" ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : handleStatus === "taken" ? (
                  <X className="h-4 w-4 text-red-400" />
                ) : null}
              </span>
            </div>
            {handleStatus === "taken" ? (
              <p className="text-xs text-red-400">That handle is already taken.</p>
            ) : (
              <p className="text-xs text-muted-foreground">Lowercase letters, numbers, underscore. Unique across The Ledger.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Date of birth</label>
            <input type="date" className={field} value={dob} max={minDob} onChange={(e) => setDob(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Role type</label>
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
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Company / startup name</label>
            <input className={field} value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={80} placeholder="Nimbus Cloud" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">One-sentence bio</label>
            <textarea rows={2} className={field + " resize-none"} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200} placeholder="Building the boring infra everyone depends on." />
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

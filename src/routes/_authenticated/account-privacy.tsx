import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, MessageSquare, EyeOff } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/account-privacy")({
  head: () => ({ meta: [{ title: "Privacy & Network · The Ledger" }] }),
  component: PrivacySettingsPage,
});

function LuxToggle({
  checked, onChange, disabled = false,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-5 w-9 shrink-0 rounded-full transition-all disabled:opacity-40"
      style={{
        background: checked ? "rgba(245,245,246,0.90)" : "rgba(255,255,255,0.10)",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform"
        style={{ transform: checked ? "translateX(16px)" : "translateX(2px)" }}
      />
    </button>
  );
}

function PrivacySettingsPage() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [dmRestrict, setDmRestrict] = useState(profile?.dm_cloaking_enabled ?? false);
  const [hideSearch, setHideSearch] = useState(profile?.hide_from_search ?? false);
  const [busyDm, setBusyDm]         = useState(false);
  const [busyHide, setBusyHide]     = useState(false);

  async function toggleDm(next: boolean) {
    if (!user) return;
    setDmRestrict(next);
    setBusyDm(true);
    const { error } = await supabase
      .from("profiles")
      .update({ dm_cloaking_enabled: next } as any)
      .eq("id", user.id);
    setBusyDm(false);
    if (error) { toast.error(error.message); setDmRestrict(!next); return; }
    await refreshProfile();
    toast.success(next ? "DMs restricted to verified members." : "DM restriction removed.");
  }

  async function toggleHide(next: boolean) {
    if (!user) return;
    setHideSearch(next);
    setBusyHide(true);
    const { error } = await supabase
      .from("profiles")
      .update({ hide_from_search: next } as any)
      .eq("id", user.id);
    setBusyHide(false);
    if (error) { toast.error(error.message); setHideSearch(!next); return; }
    await refreshProfile();
    toast.success(next ? "Profile hidden from search engines." : "Profile visible in search.");
  }

  const rows = [
    {
      icon: MessageSquare,
      label: "Restrict DMs to Verified Members",
      desc: "Only Silver & Gold users can see your message button.",
      checked: dmRestrict,
      onChange: toggleDm,
      disabled: busyDm,
    },
    {
      icon: EyeOff,
      label: "Hide Profile from Search Engines",
      desc: "Adds a noindex directive to your public profile.",
      checked: hideSearch,
      onChange: toggleHide,
      disabled: busyHide,
    },
  ];

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
          <h1 className="text-[17px] font-semibold tracking-tight">Privacy & Network</h1>
        </div>
      </div>

      <main className="mx-auto max-w-lg px-4 pt-8 pb-28">
        <div
          className="overflow-hidden rounded-2xl"
          style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(26,26,30,0.60)" }}
        >
          {rows.map((r, i) => (
            <div
              key={r.label}
              className="flex items-center justify-between gap-6 px-5 py-4"
              style={i < rows.length - 1 ? { borderBottom: "1px solid rgba(255,255,255,0.05)" } : {}}
            >
              <div className="flex items-center gap-3">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: "rgba(255,255,255,0.06)" }}
                >
                  <r.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">{r.label}</p>
                  <p className="text-[11px] text-muted-foreground">{r.desc}</p>
                </div>
              </div>
              <LuxToggle checked={r.checked} onChange={r.onChange} disabled={r.disabled} />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

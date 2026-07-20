import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  User, LogOut, ShieldCheck, EyeOff, Bell, ChevronRight, Loader2,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { VerificationBadge } from "@/components/VerificationBadge";
import { LedgerMark } from "@/components/AppHeader";

function tierRingColor(tier?: string | null) {
  if (tier === "gold")   return "rgba(251,191,36,0.85)";
  if (tier === "silver") return "rgba(148,163,184,0.70)";
  return "rgba(255,255,255,0.15)";
}

const SETTINGS_NAV = [
  {
    label: "Security & Auth",
    desc:  "Password & linked accounts",
    icon:  ShieldCheck,
    to:    "/account-security",
  },
  {
    label: "Privacy & Network",
    desc:  "DM toggles & visibility",
    icon:  EyeOff,
    to:    "/account-privacy",
  },
  {
    label: "Notification Preferences",
    desc:  "Alerts & system updates",
    icon:  Bell,
    to:    "/account-notifications",
  },
] as const;

export function ProfileDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);

  function close() { onOpenChange(false); }

  async function signOut() {
    setSigningOut(true);
    close();
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  if (!user) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="flex w-[280px] flex-col border-r p-0 sm:max-w-[280px]"
        style={{ background: "#0B0B0C", borderColor: "rgba(255,255,255,0.07)" }}
      >
        {/* ── Profile header ─────────────────────────────────────────────── */}
        <div
          className="relative flex flex-col gap-3 px-5 pb-5 pt-8"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
        >
          {/* Ambient glow */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 200px 130px at 30px -20px, rgba(251,191,36,0.07) 0%, transparent 100%)",
            }}
          />

          {/* Avatar */}
          <div
            className="relative h-[60px] w-[60px] overflow-hidden rounded-full"
            style={{
              background: "rgba(255,255,255,0.07)",
              boxShadow: `0 0 0 2.5px ${tierRingColor(profile?.verification_tier)}, 0 0 0 4.5px #0B0B0C`,
            }}
          >
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="grid h-full w-full place-items-center text-xl font-semibold text-foreground/80">
                {profile?.display_name?.charAt(0).toUpperCase() ?? "?"}
              </span>
            )}
          </div>

          {/* Name + handle */}
          <div>
            <p className="flex items-center gap-1.5 text-[15px] font-semibold leading-tight tracking-[-0.02em]">
              {profile?.display_name ?? "—"}
              {profile && <VerificationBadge tier={profile.verification_tier} size={13} />}
            </p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              @{profile?.handle ?? "…"}
            </p>
          </div>

          {/* View profile CTA */}
          {profile ? (
            <Link
              to="/u/$handle"
              params={{ handle: profile.handle }}
              search={{ tab: undefined }}
              onClick={close}
              className="inline-flex w-fit items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-medium text-foreground/70 transition-colors hover:border-white/20 hover:text-foreground"
              style={{ borderColor: "rgba(255,255,255,0.10)" }}
            >
              <User className="h-3 w-3" />
              View profile
            </Link>
          ) : (
            <Link
              to="/onboarding"
              onClick={close}
              className="inline-flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-background transition-opacity hover:opacity-90"
              style={{ background: "#FBBF24" }}
            >
              <User className="h-3 w-3" />
              Complete your profile
            </Link>
          )}

          <div className="absolute right-4 top-4 opacity-[0.14]">
            <LedgerMark className="h-4 w-auto" />
          </div>
        </div>

        {/* ── Settings nav ───────────────────────────────────────────────── */}
        <nav className="flex-1 overflow-y-auto py-2">
          <p className="px-5 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/50">
            Settings
          </p>

          {SETTINGS_NAV.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => { close(); navigate({ to: item.to }); }}
              className="flex w-full items-center gap-3.5 px-5 py-3.5 text-left transition-colors hover:bg-white/[0.04] active:bg-white/[0.07]"
            >
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                style={{ background: "rgba(255,255,255,0.07)" }}
              >
                <item.icon className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-foreground/90 leading-tight">{item.label}</p>
                <p className="text-[11px] text-muted-foreground/60 leading-snug">{item.desc}</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/30" />
            </button>
          ))}
        </nav>

        {/* ── Sign Out ───────────────────────────────────────────────────── */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="flex w-full items-center gap-3.5 px-5 py-4 text-left transition-colors hover:bg-red-500/[0.07] active:bg-red-500/[0.12] disabled:opacity-50"
          >
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
              style={{ background: "rgba(239,68,68,0.12)" }}
            >
              {signingOut
                ? <Loader2 className="h-[15px] w-[15px] animate-spin text-red-400" />
                : <LogOut className="h-[15px] w-[15px] text-red-400" strokeWidth={1.8} />
              }
            </div>
            <span className="text-[13.5px] font-medium text-red-400">Sign out</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

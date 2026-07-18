import { Link, useNavigate } from "@tanstack/react-router";
import {
  LogOut, User, Rss, PenSquare, Zap,
  MessageSquare, Bell, Settings as SettingsIcon,
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

const NAV = [
  { label: "Feed",          icon: Rss,           to: "/feed"          },
  { label: "PulseAssist",   icon: Zap,           to: "/pulse"         },
  { label: "Studio",        icon: PenSquare,     to: "/studio"        },
  { label: "Messages",      icon: MessageSquare, to: "/messages"      },
  { label: "Notifications", icon: Bell,          to: "/notifications" },
  { label: "Settings",      icon: SettingsIcon,  to: "/settings"      },
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

  async function signOut() {
    onOpenChange(false);
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  function close() { onOpenChange(false); }

  if (!user) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="flex w-[272px] flex-col border-r p-0 sm:max-w-[272px]"
        style={{
          background: "#0B0B0C",
          borderColor: "rgba(255,255,255,0.07)",
        }}
      >
        {/* ── Profile card ── */}
        <div
          className="relative flex flex-col gap-3 px-5 pb-5 pt-8"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          {/* Ambient gold glow behind avatar */}
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

          {/* "My Profile" CTA */}
          {profile && (
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
          )}

          {/* Ledger mark watermark */}
          <div className="absolute right-4 top-4 opacity-[0.14]">
            <LedgerMark className="h-4 w-auto" />
          </div>
        </div>

        {/* ── Nav links ── */}
        <nav className="flex-1 overflow-y-auto py-1.5">
          {NAV.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              onClick={close}
              className="flex items-center gap-3.5 px-5 py-3 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
              activeProps={{
                className:
                  "flex items-center gap-3.5 px-5 py-3 text-[13.5px] font-medium text-foreground",
                style: { background: "rgba(255,255,255,0.04)" },
              }}
            >
              <item.icon className="h-[16px] w-[16px] shrink-0" strokeWidth={1.8} />
              {item.label}
            </Link>
          ))}
        </nav>

        {/* ── Footer ── */}
        <div
          className="p-3"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3.5 rounded-xl px-4 py-2.5 text-[13px] font-medium text-muted-foreground/70 transition-colors hover:bg-white/[0.05] hover:text-foreground"
          >
            <LogOut className="h-[15px] w-[15px] shrink-0" strokeWidth={1.75} />
            Sign out
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

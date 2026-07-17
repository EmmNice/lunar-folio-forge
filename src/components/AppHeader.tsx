import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, Rss, PenSquare, Settings as SettingsIcon, MessageSquare, Bell, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { VerificationBadge } from "@/components/VerificationBadge";

// Desktop top nav — three primary sections
const DESKTOP_NAV = [
  { to: "/feed" as const, label: "Explore", icon: Rss },
  { to: "/pulse" as const, label: "PulseAssist", icon: Zap },
  { to: "/studio" as const, label: "Workspace", icon: PenSquare },
];

// Mobile bottom bar — exactly three zones
const MOBILE_TABS = [
  { to: "/feed" as const, label: "Explore", icon: Rss },
  { to: "/pulse" as const, label: "PulseAssist", icon: Zap },
  { to: "/studio" as const, label: "Workspace", icon: PenSquare },
];

export function AppHeader() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [unreadCount, setUnreadCount] = useState(0);
  const [hidden, setHidden] = useState(false);

  // ── Scroll direction detector for auto-hide ──────────────────────────────
  useEffect(() => {
    let lastY = window.scrollY;
    function onScroll() {
      const y = window.scrollY;
      // Only hide after scrolled past header height (~56 px)
      if (y > lastY && y > 64) {
        setHidden(true);
      } else if (y < lastY) {
        setHidden(false);
      }
      lastY = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!user) { setUnreadCount(0); return; }
    let cancelled = false;

    async function fetchUnread() {
      const { count } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .eq("read", false);
      if (!cancelled) setUnreadCount(count ?? 0);
    }

    fetchUnread();

    const channel = supabase
      .channel(`notif-badge:${user.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${user.id}`,
      }, () => setUnreadCount((n) => n + 1))
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${user.id}`,
      }, () => fetchUnread())
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [user]);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  return (
    <>
      {/* ── Top nav ── */}
      <header
        className="sticky top-0 z-40 border-b backdrop-blur-md"
        style={{
          background: "rgba(11,11,12,0.88)",
          borderColor: "rgba(255,255,255,0.07)",
          transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          transform: hidden ? "translateY(-100%)" : "translateY(0)",
        }}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">

          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
            <span
              className="grid h-6 w-6 place-items-center rounded-[5px] text-[11px] font-bold"
              style={{ background: "#F5F5F6", color: "#0B0B0C" }}
            >
              L
            </span>
            <span className="text-sm font-semibold tracking-[-0.01em]">The Ledger</span>
          </Link>

          {/* Desktop primary nav */}
          <nav className="hidden items-center gap-0.5 sm:flex">
            {DESKTOP_NAV.map((t) => (
              <Link
                key={t.to}
                to={t.to}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                activeProps={{
                  className: "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-foreground font-medium",
                  style: { background: "rgba(255,255,255,0.06)" },
                }}
              >
                <t.icon className="h-[14px] w-[14px]" />
                {t.label}
              </Link>
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-1">
            {loading ? (
              <span className="h-7 w-20 animate-pulse rounded-full bg-white/6" />
            ) : user ? (
              <>
                {/* Notifications bell */}
                <Link
                  to="/notifications"
                  aria-label="Notifications"
                  className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
                  activeProps={{
                    className: "relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground",
                    style: { background: "rgba(255,255,255,0.07)" },
                  }}
                >
                  <Bell className="h-[15px] w-[15px]" />
                  {unreadCount > 0 && (
                    <span className="absolute right-1 top-1 h-[6px] w-[6px] rounded-full bg-foreground ring-1 ring-[#0B0B0C]" />
                  )}
                </Link>

                {/* Messages */}
                <Link
                  to="/messages"
                  aria-label="Messages"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
                  activeProps={{
                    className: "inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground",
                    style: { background: "rgba(255,255,255,0.07)" },
                  }}
                >
                  <MessageSquare className="h-[15px] w-[15px]" />
                </Link>

                {/* ⚙ Account Settings gear */}
                <Link
                  to="/settings"
                  aria-label="Account Settings"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
                  activeProps={{
                    className: "inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground",
                    style: { background: "rgba(255,255,255,0.07)" },
                  }}
                >
                  <SettingsIcon className="h-[15px] w-[15px]" />
                </Link>

                {/* Profile avatar — links to My Profile */}
                {profile && (
                  <Link
                    to="/u/$handle"
                    params={{ handle: profile.handle }}
                    search={{ tab: undefined }}
                    aria-label="My Profile"
                    className="ml-0.5 inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                    style={{ borderColor: "rgba(255,255,255,0.10)" }}
                  >
                    {profile.avatar_url ? (
                      <img
                        src={profile.avatar_url}
                        alt=""
                        className="h-[18px] w-[18px] rounded-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span
                        className="grid h-[18px] w-[18px] place-items-center rounded-full text-[9px] font-semibold"
                        style={{ background: "rgba(255,255,255,0.09)" }}
                      >
                        {profile.display_name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="hidden items-center gap-1 sm:inline-flex">
                      @{profile.handle}
                      <VerificationBadge tier={profile.verification_tier} size={11} />
                    </span>
                  </Link>
                )}
              </>
            ) : (
              <Link
                to="/"
                className="rounded-lg px-3.5 py-1.5 text-[12px] font-medium text-background transition-opacity hover:opacity-85"
                style={{ background: "#F5F5F6" }}
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* ── Mobile bottom tab bar — three zones ── */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex sm:hidden"
        style={{
          background: "rgba(11,11,12,0.92)",
          borderTop: "1px solid rgba(255,255,255,0.07)",
          backdropFilter: "blur(20px)",
        }}
      >
        {MOBILE_TABS.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium text-muted-foreground transition-colors"
            activeProps={{
              className: "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium text-foreground",
            }}
          >
            {t.to === "/pulse" ? (
              <div
                className="flex h-6 w-6 items-center justify-center rounded-md"
                style={{ background: "rgba(167,139,250,0.15)" }}
              >
                <t.icon className="h-[14px] w-[14px] text-violet-400" />
              </div>
            ) : (
              <t.icon className="h-[18px] w-[18px]" />
            )}
            {t.label}
          </Link>
        ))}
      </nav>
    </>
  );
}

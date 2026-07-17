import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, Rss, PenSquare, Settings as SettingsIcon, MessageSquare, ShieldCheck, Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { VerificationBadge } from "@/components/VerificationBadge";

const TABS = [
  { to: "/feed" as const, label: "Explore Feed", icon: Rss },
  { to: "/studio" as const, label: "Workspace Studio", icon: PenSquare },
  { to: "/settings" as const, label: "Studio Settings", icon: SettingsIcon },
];

export function AppHeader() {
  const { user, profile, loading, isAdmin } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [unreadCount, setUnreadCount] = useState(0);

  // Fetch unread notification count
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

    // Subscribe to new notifications in realtime
    const channel = supabase
      .channel(`notif-badge:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => setUnreadCount((n) => n + 1),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => fetchUnread(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
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
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
            <span className="grid h-6 w-6 place-items-center rounded-[5px] bg-foreground text-[11px] font-bold text-background">
              L
            </span>
            <span className="text-sm font-semibold tracking-[-0.01em]">The Ledger</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center text-sm sm:flex">
            {TABS.map((t) => (
              <Link
                key={t.to}
                to={t.to}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                activeProps={{ className: "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-foreground font-medium" }}
              >
                <t.icon className="h-[15px] w-[15px]" />
                {t.label}
              </Link>
            ))}
            {isAdmin && (
              <Link
                to="/admin"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-amber-400/60 transition-colors hover:text-amber-400"
                activeProps={{ className: "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-amber-400 font-medium bg-amber-500/8" }}
              >
                <ShieldCheck className="h-[15px] w-[15px]" /> Admin
              </Link>
            )}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-1">
            {loading ? (
              <span className="h-7 w-24 animate-pulse rounded-full bg-secondary/60" />
            ) : user ? (
              <>
                {/* Notifications */}
                <Link
                  to="/notifications"
                  aria-label="Notifications"
                  className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                  activeProps={{ className: "relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground bg-secondary/60" }}
                >
                  <Bell className="h-[15px] w-[15px]" />
                  {unreadCount > 0 && (
                    <span className="absolute right-1 top-1 flex h-[7px] w-[7px] items-center justify-center rounded-full bg-foreground text-[8px] font-bold text-background ring-1 ring-background" />
                  )}
                </Link>

                {/* Messages */}
                <Link
                  to="/messages"
                  aria-label="Messages"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                  activeProps={{ className: "inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground bg-secondary/60" }}
                >
                  <MessageSquare className="h-[15px] w-[15px]" />
                </Link>

                {profile && (
                  <Link
                    to="/u/$handle"
                    params={{ handle: profile.handle }}
                    className="ml-0.5 inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                  >
                    {profile.avatar_url ? (
                      <img
                        src={profile.avatar_url}
                        alt=""
                        className="h-[18px] w-[18px] rounded-full object-cover ring-1 ring-border/50"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-secondary text-[9px] font-semibold">
                        {profile.display_name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="hidden items-center gap-1 sm:inline-flex">
                      @{profile.handle}
                      <VerificationBadge tier={profile.verification_tier} size={11} />
                    </span>
                  </Link>
                )}

                <button
                  type="button"
                  onClick={signOut}
                  aria-label="Sign out"
                  className="ml-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                >
                  <LogOut className="h-[15px] w-[15px]" />
                </button>
              </>
            ) : (
              <Link
                to="/"
                className="rounded-lg bg-foreground px-3.5 py-1.5 text-[12px] font-medium text-background transition-opacity hover:opacity-85"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* ── Mobile bottom tab bar ── */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border/50 bg-background/90 backdrop-blur-md sm:hidden">
        {TABS.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium text-muted-foreground transition-colors"
            activeProps={{ className: "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium text-foreground" }}
          >
            <t.icon className="h-[18px] w-[18px]" />
            {t.label.split(" ")[0]}
          </Link>
        ))}
        {/* Notifications in mobile bar */}
        <Link
          to="/notifications"
          className="relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium text-muted-foreground transition-colors"
          activeProps={{ className: "relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium text-foreground" }}
        >
          <Bell className="h-[18px] w-[18px]" />
          {unreadCount > 0 && (
            <span className="absolute right-[calc(50%-14px)] top-2 h-[7px] w-[7px] rounded-full bg-foreground ring-1 ring-background" />
          )}
          Alerts
        </Link>
      </nav>
    </>
  );
}

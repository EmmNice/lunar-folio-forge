import { Link, useRouterState } from "@tanstack/react-router";
import { Settings as SettingsIcon, MessageSquare, Bell, Rss, PenSquare, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { VerificationBadge } from "@/components/VerificationBadge";

/** The Ledger geometric mark — three ascending signal bars */
export function LedgerMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 22 18"
      fill="none"
      aria-label="The Ledger"
      role="img"
    >
      <rect x="0"    y="9"   width="5" height="9"    rx="1.5" fill="#F5F5F6" />
      <rect x="8.5"  y="4.5" width="5" height="13.5" rx="1.5" fill="#F5F5F6" />
      <rect x="17"   y="0"   width="5" height="18"   rx="1.5" fill="#FBBF24" />
    </svg>
  );
}

/** Tier-colored avatar ring */
function tierRingColor(tier?: string | null) {
  if (tier === "gold")   return "rgba(251,191,36,0.80)";
  if (tier === "silver") return "rgba(148,163,184,0.65)";
  return "rgba(255,255,255,0.13)";
}

const DESKTOP_NAV = [
  { to: "/feed"    as const, label: "Explore",     icon: Rss      },
  { to: "/pulse"   as const, label: "PulseAssist", icon: Zap      },
  { to: "/studio"  as const, label: "Workspace",   icon: PenSquare },
] as const;

const BOTTOM_TABS = [
  { to: "/feed"          as const, label: "Feed",     icon: Rss            },
  { to: "/studio"        as const, label: "Studio",   icon: PenSquare      },
  { to: "/pulse"         as const, label: "Pulse",    icon: Zap            },
  { to: "/messages"      as const, label: "Messages", icon: MessageSquare  },
  { to: "/notifications" as const, label: "Alerts",   icon: Bell           },
] as const;

/**
 * Top application header.
 * Layout: [Avatar + Settings] | [Logo — center] | [Desktop nav or Sign in]
 *
 * controlled — when true, the outer container owns sticky/hide behaviour.
 */
export function AppHeader({ controlled = false }: { controlled?: boolean } = {}) {
  const { user, profile, loading } = useAuth();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (controlled) return;
    let lastY = window.scrollY;
    function onScroll() {
      const y = window.scrollY;
      if (y > lastY && y > 64) setHidden(true);
      else if (y < lastY) setHidden(false);
      lastY = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [controlled]);

  return (
    <>
      <header
        className={controlled ? "" : "sticky top-0 z-40 border-b backdrop-blur-md"}
        style={controlled ? {} : {
          background: "rgba(11,11,12,0.90)",
          borderColor: "rgba(255,255,255,0.06)",
          transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          transform: hidden ? "translateY(-100%)" : "translateY(0)",
        }}
      >
        {/* Three-column grid: left | center | right */}
        <div className="mx-auto grid h-14 max-w-6xl grid-cols-3 items-center px-4 sm:px-6">

          {/* ── LEFT: avatar → profile + settings ── */}
          <div className="flex items-center gap-1.5">
            {loading ? (
              <span className="h-8 w-20 animate-pulse rounded-full bg-white/5" />
            ) : user ? (
              <>
                {/* Avatar with tier ring — shown once profile is loaded */}
                {profile ? (
                  <Link
                    to="/u/$handle"
                    params={{ handle: profile.handle }}
                    search={{ tab: undefined }}
                    aria-label="My Profile"
                    className="group flex items-center gap-2 rounded-full outline-none"
                  >
                    <span
                      className="relative flex h-8 w-8 shrink-0 overflow-hidden rounded-full transition-opacity group-hover:opacity-80"
                      style={{
                        boxShadow: `0 0 0 2px ${tierRingColor(profile.verification_tier)}, 0 0 0 3.5px rgba(11,11,12,0.90)`,
                        background: "rgba(255,255,255,0.07)",
                      }}
                    >
                      {profile.avatar_url ? (
                        <img
                          src={profile.avatar_url}
                          alt=""
                          className="h-full w-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="grid h-full w-full place-items-center text-[11px] font-semibold">
                          {profile.display_name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </span>

                    {/* @handle + badge — desktop only */}
                    <span className="hidden items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors group-hover:text-foreground sm:inline-flex">
                      @{profile.handle}
                      <VerificationBadge tier={profile.verification_tier} size={11} />
                    </span>
                  </Link>
                ) : (
                  <span className="h-8 w-8 animate-pulse rounded-full bg-white/5" />
                )}

                {/* Settings gear — always visible when logged in, profile not required */}
                <Link
                  to="/settings"
                  aria-label="Account Settings"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
                  style={{ color: "rgba(255,255,255,0.35)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.75)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}
                >
                  <SettingsIcon className="h-[13px] w-[13px]" />
                </Link>
              </>
            ) : null}
          </div>

          {/* ── CENTER: brand mark ── */}
          <div className="flex justify-center">
            <Link
              to={user ? "/feed" : "/"}
              className="group flex items-center gap-2 transition-opacity hover:opacity-75"
            >
              <LedgerMark className="h-[18px] w-auto" />
              <span className="text-[13px] font-semibold tracking-[-0.02em]">The Ledger</span>
            </Link>
          </div>

          {/* ── RIGHT: desktop nav (auth) / sign-in (guest) ── */}
          <div className="flex items-center justify-end">
            {loading ? null : user ? (
              <nav className="hidden items-center gap-0.5 sm:flex">
                {DESKTOP_NAV.map((t) => (
                  <Link
                    key={t.to}
                    to={t.to}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                    activeProps={{
                      className: "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] text-foreground font-medium",
                      style: { background: "rgba(255,255,255,0.06)" },
                    }}
                  >
                    <t.icon className="h-[13px] w-[13px]" />
                    {t.label}
                  </Link>
                ))}
              </nav>
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

      {!controlled && <MobileNav />}
    </>
  );
}

/**
 * Five-tab mobile bottom bar.
 * Exported separately so pages that use a CSS-transform ancestor can render
 * it outside that ancestor (position:fixed is relative to the nearest
 * transformed parent otherwise).
 *
 * Fetches its own unread notification count so it works whether rendered
 * by AppHeader or a page directly.
 */
export function MobileNav() {
  const { user } = useAuth();
  const { location } = useRouterState();
  const pathname = location.pathname;
  const [unreadCount, setUnreadCount] = useState(0);

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
      .channel(`mobile-notif:${user.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "notifications",
        filter: `user_id=eq.${user.id}`,
      }, () => setUnreadCount((n) => n + 1))
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "notifications",
        filter: `user_id=eq.${user.id}`,
      }, () => fetchUnread())
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [user]);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex sm:hidden"
      style={{
        background: "rgba(11,11,12,0.94)",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(24px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {BOTTOM_TABS.map((t) => {
        const isActive =
          pathname === t.to ||
          (t.to !== "/feed" && pathname.startsWith(t.to + "/")) ||
          (t.to === "/feed" && pathname.startsWith("/feed"));
        const showBadge = t.to === "/notifications" && unreadCount > 0;

        return (
          <Link
            key={t.to}
            to={t.to}
            className="relative flex flex-1 flex-col items-center justify-center gap-[3px] py-2.5"
            style={{ WebkitTapHighlightColor: "transparent" }}
          >
            {/* Amber top bar — active indicator */}
            {isActive && (
              <span
                className="absolute inset-x-[22%] top-0 h-[2px] rounded-b-full"
                style={{ background: "rgba(251,191,36,0.85)" }}
              />
            )}

            {/* Icon */}
            <span className="relative">
              <t.icon
                className="h-[19px] w-[19px]"
                style={{
                  color: isActive ? "#F5F5F6" : "#5A5A68",
                  strokeWidth: isActive ? 2.1 : 1.65,
                  transition: "color 0.15s, stroke-width 0.15s",
                }}
              />
              {showBadge && (
                <span
                  className="absolute -right-[3px] -top-[3px] h-[5px] w-[5px] rounded-full"
                  style={{
                    background: "#FBBF24",
                    boxShadow: "0 0 0 1.5px #0B0B0C",
                  }}
                />
              )}
            </span>

            {/* Label */}
            <span
              className="text-[9px] font-medium tracking-[0.04em]"
              style={{
                color: isActive ? "#E5E5E6" : "#5A5A68",
                transition: "color 0.15s",
              }}
            >
              {t.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

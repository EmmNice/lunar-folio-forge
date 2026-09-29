import { Link, useRouterState } from "@tanstack/react-router";
import { MessageSquare, Bell, Rss, PenSquare, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { subscribeToUnreadCount } from "@/lib/unread-count";
import { VerificationBadge } from "@/components/VerificationBadge";
import { ProfileDrawer } from "@/components/ProfileDrawer";

/** The Ledger geometric mark — three ascending signal bars */
export function LedgerMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 22 18" fill="none" aria-label="The Ledger" role="img">
      <rect x="0" y="9" width="5" height="9" rx="1.5" fill="#F5F5F6" />
      <rect x="8.5" y="4.5" width="5" height="13.5" rx="1.5" fill="#F5F5F6" />
      <rect x="17" y="0" width="5" height="18" rx="1.5" fill="#FBBF24" />
    </svg>
  );
}

/** Tier-colored avatar ring */
function tierRingColor(tier?: string | null) {
  if (tier === "gold") return "rgba(251,191,36,0.80)";
  if (tier === "silver") return "rgba(203,213,225,0.65)";
  return "rgba(255,255,255,0.14)";
}

const PRIMARY_NAV = [
  { to: "/feed" as const, label: "Explore", icon: Rss },
  { to: "/pulse" as const, label: "PulseAssist", icon: Zap },
  { to: "/studio" as const, label: "Studio", icon: PenSquare },
] as const;

const BOTTOM_TABS = [
  { to: "/feed" as const, label: "Feed", icon: Rss },
  { to: "/studio" as const, label: "Studio", icon: PenSquare },
  { to: "/pulse" as const, label: "Pulse", icon: Zap },
  { to: "/messages" as const, label: "Inbox", icon: MessageSquare },
  { to: "/notifications" as const, label: "Alerts", icon: Bell },
] as const;

/**
 * Unread notification count, live.
 *
 * Was fetched inside MobileNav only, which meant desktop had no unread indicator
 * at all — a member on a laptop had no way to know a message or a verification
 * decision had arrived without opening the page. The subscription itself lives in
 * lib/unread-count.ts because the header and the tab bar are both mounted at
 * once, and two channels with the same name is an error rather than a duplicate.
 */
function useUnreadCount(): number {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setCount(0);
      return;
    }
    return subscribeToUnreadCount(user.id, setCount);
  }, [user]);

  return count;
}

function Avatar({
  url,
  initial,
  tier,
  size = 36,
}: {
  url: string | null | undefined;
  initial: string;
  tier?: string | null;
  size?: number;
}) {
  return (
    <span
      className="relative flex shrink-0 overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        boxShadow: `0 0 0 2px ${tierRingColor(tier)}`,
        background: url ? "transparent" : "rgba(251,191,36,0.16)",
      }}
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <span
          className="grid h-full w-full place-items-center text-[13px] font-bold"
          style={{ color: "var(--gold)" }}
        >
          {initial}
        </span>
      )}
    </span>
  );
}

/**
 * Top application header.
 *
 * The brand used to sit centred with the avatar on the left and the nav squeezed
 * into the right third at 12px — a phone layout stretched across a desktop. Brand
 * and navigation now start at the left where they are scanned first, and the right
 * side holds the things that change: inbox, alerts, you.
 *
 * `controlled` — when true, the outer container owns sticky/hide behaviour.
 */
export function AppHeader({ controlled = false }: { controlled?: boolean } = {}) {
  const { user, profile, loading } = useAuth();
  const [hidden, setHidden] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const unread = useUnreadCount();

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

  const initial = profile?.display_name?.charAt(0).toUpperCase() ?? "?";

  return (
    <>
      <header
        className={controlled ? "" : "sticky top-0 z-40 border-b glass"}
        style={
          controlled
            ? {}
            : {
                borderColor: "var(--border)",
                transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                transform: hidden ? "translateY(-100%)" : "translateY(0)",
              }
        }
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          {/* Brand */}
          <Link
            to={user ? "/feed" : "/"}
            className="flex shrink-0 items-center gap-2.5 transition-opacity hover:opacity-80"
          >
            <LedgerMark className="h-[18px] w-auto" />
            <span className="text-[15px] font-semibold tracking-tight">The Ledger</span>
          </Link>

          {/* Primary nav — desktop */}
          {user ? (
            <nav className="ml-4 hidden items-center gap-1 sm:flex">
              {PRIMARY_NAV.map((t) => (
                <Link
                  key={t.to}
                  to={t.to}
                  className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium text-secondary transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
                  activeProps={{
                    className:
                      "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium text-foreground bg-[var(--surface-2)]",
                  }}
                >
                  <t.icon className="h-4 w-4" />
                  {t.label}
                </Link>
              ))}
            </nav>
          ) : null}

          <div className="ml-auto flex items-center gap-1">
            {loading ? (
              <span className="skeleton h-9 w-9 rounded-full" />
            ) : user ? (
              <>
                {/* Inbox and alerts: desktop only — the tab bar covers them on phones. */}
                <Link
                  to="/messages"
                  aria-label="Inbox"
                  className="btn-icon hidden sm:inline-flex"
                  activeProps={{
                    style: { background: "var(--surface-2)", color: "var(--foreground)" },
                  }}
                >
                  <MessageSquare className="h-[18px] w-[18px]" />
                </Link>
                <Link
                  to="/notifications"
                  aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
                  className="btn-icon relative hidden sm:inline-flex"
                  activeProps={{
                    style: { background: "var(--surface-2)", color: "var(--foreground)" },
                  }}
                >
                  <Bell className="h-[18px] w-[18px]" />
                  {unread > 0 ? (
                    <span className="badge-count absolute -right-0.5 -top-0.5">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  ) : null}
                </Link>

                <button
                  type="button"
                  aria-label="Open profile menu"
                  onClick={() => setDrawerOpen(true)}
                  className="ml-1 flex items-center gap-2 rounded-full transition-opacity hover:opacity-80"
                >
                  <Avatar
                    url={profile?.avatar_url}
                    initial={initial}
                    tier={profile?.verification_tier}
                  />
                  {profile ? (
                    <span className="hidden items-center gap-1 pr-1 text-[13px] font-medium text-secondary lg:inline-flex">
                      @{profile.handle}
                      <VerificationBadge tier={profile.verification_tier} size={11} />
                    </span>
                  ) : null}
                </button>
              </>
            ) : (
              <Link to="/" className="btn btn-primary btn-sm">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      {!controlled && <MobileNav />}

      <ProfileDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </>
  );
}

/**
 * Five-tab mobile bottom bar.
 *
 * Exported separately so pages with a CSS-transformed ancestor can render it
 * outside that ancestor — `position: fixed` resolves against the nearest
 * transformed parent otherwise, and the bar ends up scrolling with the page.
 */
export function MobileNav() {
  const { user } = useAuth();
  const { location } = useRouterState();
  const pathname = location.pathname;
  const unread = useUnreadCount();

  if (!user) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t glass sm:hidden"
      style={{
        borderColor: "var(--border)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
      aria-label="Primary"
    >
      {BOTTOM_TABS.map((t) => {
        const isActive =
          pathname === t.to ||
          (t.to !== "/feed" && pathname.startsWith(t.to + "/")) ||
          (t.to === "/feed" && pathname.startsWith("/feed"));
        const badge = t.to === "/notifications" ? unread : 0;

        return (
          <Link
            key={t.to}
            to={t.to}
            aria-current={isActive ? "page" : undefined}
            /* min-h keeps every tab at a comfortable thumb target. */
            className="relative flex min-h-[3.5rem] flex-1 flex-col items-center justify-center gap-1"
            style={{ WebkitTapHighlightColor: "transparent" }}
          >
            {isActive && (
              <span
                className="absolute inset-x-[26%] top-0 h-[2px] rounded-b-full"
                style={{ background: "var(--gold)" }}
              />
            )}

            <span className="relative">
              <t.icon
                className="h-[20px] w-[20px] transition-colors"
                style={{
                  color: isActive ? "var(--foreground)" : "var(--text-tertiary)",
                  strokeWidth: isActive ? 2.1 : 1.7,
                }}
              />
              {badge > 0 ? (
                <span
                  className="absolute -right-1.5 -top-1 rounded-full px-1 text-[9px] font-bold leading-[14px]"
                  style={{
                    background: "var(--gold)",
                    color: "#000",
                    minWidth: 14,
                    height: 14,
                    textAlign: "center",
                    boxShadow: "0 0 0 2px var(--bg-base)",
                  }}
                >
                  {badge > 9 ? "9+" : badge}
                </span>
              ) : null}
            </span>

            <span
              className="text-[10px] font-medium tracking-[0.02em] transition-colors"
              style={{ color: isActive ? "var(--foreground)" : "var(--text-tertiary)" }}
            >
              {t.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

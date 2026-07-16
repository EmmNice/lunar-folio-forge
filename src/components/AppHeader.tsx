import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, Rss, PenSquare, Settings as SettingsIcon, MessageSquare, ShieldCheck } from "lucide-react";
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

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md border border-border bg-secondary/60 text-xs font-semibold">
              L
            </span>
            <span className="text-sm font-semibold tracking-tight">The Ledger</span>
          </Link>

          <nav className="hidden items-center gap-1 text-sm sm:flex">
            {TABS.map((t) => (
              <Link
                key={t.to}
                to={t.to}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
                activeProps={{
                  className:
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-foreground bg-secondary/60",
                }}
              >
                <t.icon className="h-4 w-4" /> {t.label}
              </Link>
            ))}

            {/* Admin link — only visible to admins */}
            {isAdmin && (
              <Link
                to="/admin"
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-amber-400/70 transition-colors hover:text-amber-400"
                activeProps={{
                  className:
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-amber-400 bg-amber-500/10",
                }}
              >
                <ShieldCheck className="h-4 w-4" /> Admin
              </Link>
            )}
          </nav>

          <div className="flex items-center gap-1">
            {loading ? null : user ? (
              <>
                <Link
                  to="/messages"
                  aria-label="Messages"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                  activeProps={{ className: "inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground" }}
                >
                  <MessageSquare className="h-4 w-4" />
                </Link>
                {profile ? (
                  <Link
                    to="/u/$handle"
                    params={{ handle: profile.handle }}
                    className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {profile.avatar_url ? (
                      <img
                        src={profile.avatar_url}
                        alt=""
                        className="h-5 w-5 rounded-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-secondary/60 text-[10px] font-semibold">
                        {profile.display_name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="hidden items-center gap-1 sm:inline-flex">
                      @{profile.handle}
                      <VerificationBadge tier={profile.verification_tier} size={12} />
                    </span>
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={signOut}
                  aria-label="Sign out"
                  className="ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            ) : (
              <Link
                to="/"
                className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Bottom tab bar — mobile only */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border/60 bg-background/90 backdrop-blur sm:hidden">
        {TABS.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] text-muted-foreground transition-colors"
            activeProps={{ className: "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] text-foreground" }}
          >
            <t.icon className="h-5 w-5" />
            {t.label.split(" ")[0]}
          </Link>
        ))}
      </nav>
    </>
  );
}

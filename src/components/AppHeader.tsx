import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, PenSquare, MessageSquare, User as UserIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

export function AppHeader() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md border border-border bg-secondary/60 text-xs font-semibold">
            G
          </span>
          <span className="text-sm font-semibold tracking-tight">Godson</span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          <Link
            to="/feed"
            className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
            activeProps={{ className: "rounded-md px-3 py-1.5 text-foreground" }}
          >
            Feed
          </Link>
          {loading ? null : user ? (
            <>
              <Link
                to="/studio"
                className="hidden items-center gap-1.5 rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
                activeProps={{
                  className:
                    "hidden sm:inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-foreground",
                }}
              >
                <PenSquare className="h-4 w-4" /> Studio
              </Link>
              <Link
                to="/messages"
                className="hidden items-center gap-1.5 rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
                activeProps={{
                  className:
                    "hidden sm:inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-foreground",
                }}
              >
                <MessageSquare className="h-4 w-4" /> Messages
              </Link>
              {profile ? (
                <Link
                  to="/u/$handle"
                  params={{ handle: profile.handle }}
                  className="ml-1 inline-flex items-center gap-2 rounded-full border border-border/70 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {profile.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt=""
                      className="h-5 w-5 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <UserIcon className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">@{profile.handle}</span>
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
        </nav>
      </div>
    </header>
  );
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { supabase } from "@/integrations/supabase/client";
import { AuthProvider } from "@/hooks/use-auth";
import { initBrowserMonitoring } from "@/lib/monitoring.browser";
import { reportError, setMonitoringUser } from "@/lib/monitoring";
import { resetPerUserState } from "@/lib/session-reset";
// Imported at the root so its beforeinstallprompt listener is attached as soon as
// the client bundle runs — Chrome fires that event once and does not replay it.
import { registerServiceWorker } from "@/lib/pwa";
import { Toaster } from "sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">404</p>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page doesn't exist or has been moved.
        </p>
        <div className="mt-8">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-xl bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Back to The Ledger
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    // This boundary is the only place a React render error surfaces. The comment
    // here used to say "log to error tracking in production" while doing nothing
    // but console.error, so every crash a member hit was visible only in their own
    // devtools. It now actually leaves the browser (when a DSN is configured).
    if (import.meta.env.PROD) {
      console.error("[The Ledger]", error);
    }
    reportError(error, {
      source: "browser:routeErrorBoundary",
      url: typeof window === "undefined" ? undefined : window.location.href,
    });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Error
        </p>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We hit an unexpected error. Try again or head back to the feed.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-xl bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      /*
        viewport-fit=cover is what makes env(safe-area-inset-*) report real values.
        Without it every one of those insets is 0, so the bottom tab bar, the
        compose buttons and the message composer all sat under the iPhone home
        indicator once the app runs full-screen from the home screen.
      */
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      // Colours the Android status bar and task switcher to match the app.
      { name: "theme-color", content: "#0B0B0C" },
      // Home-screen launch on iOS. "black", not "black-translucent": translucent
      // would draw the page under the status bar and need top insets everywhere.
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black" },
      { name: "apple-mobile-web-app-title", content: "Ledger" },
      { title: "The Ledger — a high-signal network for tech founders" },
      {
        name: "description",
        content:
          "The Ledger: a professional feed for verified tech founders and builders. Publish live status updates, export share-ready graphics, and get verified.",
      },
      { property: "og:title", content: "The Ledger — a high-signal network for tech founders" },
      {
        property: "og:description",
        content:
          "A premium, tech-noir platform for Web3 builders, founders, and investors. One global timeline — no follower games, just signal.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/og.svg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "/og.svg" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      // iOS ignores manifest icons for the home screen and reads this instead.
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png", sizes: "180x180" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,300;0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;1,14..32,400&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  // Must run in an effect, not at module scope: this file is server-rendered and
  // the reporter registers window listeners.
  useEffect(() => {
    initBrowserMonitoring();
    // Makes the site installable and gives it an offline page. See public/sw.js
    // for why it deliberately caches nothing else.
    registerServiceWorker();
  }, []);

  useEffect(() => {
    // Only invalidate on SIGNED_OUT — SIGNED_IN is handled by useAuth hook directly.
    // Calling router.invalidate() on SIGNED_IN causes every beforeLoad to re-run,
    // doubling all DB profile fetches and causing visible flicker on sign-in.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Tags subsequent reports with the account that hit them, and clears the
      // tag on sign-out so the next person's errors aren't filed under the last.
      setMonitoringUser(session?.user?.id);
      if (event === "SIGNED_OUT") {
        queryClient.clear();
        // This listener is the catch-all for sign-outs that did not come from a
        // button — a revoked token, another tab, an expired refresh. It unmounts
        // nothing, so without this the previous account's unread-count channel
        // stayed subscribed.
        resetPerUserState();
        router.invalidate();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* One session resolution for the whole tree. Before this every component
          calling useAuth() fetched the profile itself — 18 redundant requests on a
          cold feed load, which is why the page assembled itself in pieces. */}
      <AuthProvider>
        <Outlet />
      </AuthProvider>
      <Toaster
        theme="dark"
        position="top-center"
        richColors
        closeButton
        toastOptions={{
          style: { fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" },
        }}
      />
    </QueryClientProvider>
  );
}

/**
 * Browser-side error reporting.
 *
 * Reads `VITE_SENTRY_DSN`, which is inlined at build time and is therefore
 * public — that is fine and is how Sentry DSNs are designed to be used: a DSN
 * grants the ability to *write* events to one project, nothing else. The server
 * reads the unprefixed `SENTRY_DSN` separately so the two runtimes can report to
 * different projects if that is ever wanted.
 *
 * Nothing here runs when no DSN is set, which is the normal state in development.
 */

import { initMonitoring, monitoringEnabled, reportError } from "./monitoring";

let installed = false;

export function initBrowserMonitoring() {
  // React StrictMode double-invokes effects in development, and this is called
  // from one; without the guard the listeners are registered twice and every
  // error is reported twice.
  if (installed) return;
  installed = true;

  initMonitoring({
    dsn: import.meta.env.VITE_SENTRY_DSN as string | undefined,
    release: import.meta.env.VITE_APP_RELEASE as string | undefined,
    environment: import.meta.env.PROD ? "production" : "development",
    runtime: "browser",
  });

  if (!monitoringEnabled()) return;

  // Errors React caught are reported from the route error boundary, which knows
  // more about where they happened. These two cover everything React did not see:
  // event handlers, async callbacks, and rejected promises nobody awaited.
  window.addEventListener("error", (event) => {
    reportError(event.error ?? new Error(event.message), {
      source: "browser:window.onerror",
      url: window.location.href,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportError(event.reason ?? new Error("Unhandled promise rejection"), {
      source: "browser:unhandledrejection",
      url: window.location.href,
    });
  });
}

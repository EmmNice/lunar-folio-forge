import { useSyncExternalStore } from "react";

/**
 * Installable-app plumbing: service worker registration and the install prompt.
 *
 * Every function here is safe to import during SSR. Nothing touches `window` at
 * module scope except behind a `typeof window` guard.
 */

/** Chrome's install event. Not in lib.dom yet. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export type InstallState = {
  /** Chrome/Edge/Samsung Internet handed us a prompt we can show on a tap. */
  canPrompt: boolean;
  /**
   * iOS has no install prompt at all; the only route is Share → Add to Home
   * Screen. True on iPhone/iPad when not already running from the home screen.
   */
  needsIosInstructions: boolean;
  /** Already running as the installed app (or just installed this session). */
  installed: boolean;
};

let deferred: BeforeInstallPromptEvent | null = null;
let installedThisSession = false;
const listeners = new Set<() => void>();
let snapshot: InstallState = {
  canPrompt: false,
  needsIosInstructions: false,
  installed: false,
};
const SERVER_SNAPSHOT: InstallState = snapshot;

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    // iOS Safari's own flag, which predates display-mode support there.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac, so check for touch as well.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function recompute() {
  const installed = installedThisSession || isStandalone();
  // Rebuild only on change. useSyncExternalStore re-renders on reference change
  // and will loop if getSnapshot returns a fresh object every call.
  const next: InstallState = {
    canPrompt: !installed && deferred !== null,
    needsIosInstructions: !installed && isIos(),
    installed,
  };
  if (
    next.canPrompt !== snapshot.canPrompt ||
    next.needsIosInstructions !== snapshot.needsIosInstructions ||
    next.installed !== snapshot.installed
  ) {
    snapshot = next;
    listeners.forEach((l) => l());
  }
}

/*
  Listen as soon as this module loads in the browser, not when some component
  mounts. Chrome fires beforeinstallprompt once, after the service worker is
  registered, and only to listeners present at that moment. A listener attached
  later in a drawer that has not been opened yet would never hear it.
*/
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Stop Chrome's own mini-infobar; we offer install where it makes sense.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    recompute();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installedThisSession = true;
    recompute();
  });
  recompute();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT,
  );
}

/**
 * Show the browser's install dialog. Must be called from a user gesture.
 * Returns what the person chose; "unavailable" if there is no prompt to show.
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferred;
  if (!event) return "unavailable";
  // A prompt can only be used once. Clear it before awaiting so a double tap
  // cannot call prompt() twice, which throws.
  deferred = null;
  recompute();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}

/**
 * Register /sw.js. Production only: in dev, Vite serves modules the worker has no
 * reason to know about, and a stale registration left behind by a dev session is
 * a confusing thing to debug.
 */
export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD) return;

  const register = () => {
    navigator.serviceWorker
      // updateViaCache "none": always check the network for a new sw.js, so a
      // change to the worker reaches installed phones on their next launch.
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((err) => {
        // Not fatal. The site works the same without it; only install and the
        // offline page are lost.
        console.warn("[pwa] service worker registration failed:", err);
      });
  };

  // After load, so registering never competes with the first paint.
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

/* --------------------------------------------------------------------------
   Install banner dismissal
   -------------------------------------------------------------------------- */

const DISMISS_KEY = "ledger:install-banner-dismissed-at";
/** Ask again after a fortnight rather than never: people change their minds. */
const DISMISS_FOR_MS = 14 * 24 * 60 * 60 * 1000;

export function isInstallBannerDismissed(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

export function dismissInstallBanner() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Private mode: the banner will simply come back next visit.
  }
}

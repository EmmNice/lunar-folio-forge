/*
  The Ledger service worker.

  Deliberately small. It does exactly two things: it makes the app installable,
  and it shows a proper "You're offline" page when a page navigation fails,
  instead of the browser's dinosaur.

  What it does NOT do is cache the app. That is a choice, not an omission:

  - Every response from Supabase and from the app's server functions is private
    or changes per user. A service worker that cached one would show one member's
    feed, inbox or session to the next person on the same phone, or hand back a
    signed-out page after sign-in.
  - Caching HTML or JS means a deploy no longer reaches people until the cache is
    invalidated. A bug fixed on the server would keep running on every installed
    phone. Several fixes this month only mattered because they reached people on
    their next load.
  - The hashed files under /assets/ are already cached by the browser's ordinary
    HTTP cache, so caching them here as well would add a second cache to keep
    consistent and buy no speed.

  So only page navigations are intercepted, only same-origin ones, and the
  network always wins. The only thing stored is offline.html.

  If you change OFFLINE_URL or what it depends on, bump VERSION so old copies are
  removed on activate.
*/

const VERSION = "ledger-shell-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      // cache: "reload" skips the HTTP cache, so a stale copy can't be stored.
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== VERSION) await caches.delete(key);
      }
      // Navigation preload starts the page request while the worker is still
      // booting, so having a service worker never makes a page load slower.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Everything that is not a page navigation goes straight to the network,
  // untouched: API calls, Supabase, server functions, scripts, images, fonts.
  if (request.mode !== "navigate") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;
        return await fetch(request);
      } catch {
        // fetch() only rejects on a network failure. A 404 or 500 from the
        // server is a real response and is returned as-is above, so this page
        // never hides a genuine server error behind "you're offline".
        const cache = await caches.open(VERSION);
        const offline = await cache.match(OFFLINE_URL);
        return (
          offline ||
          new Response("You're offline.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        );
      }
    })(),
  );
});

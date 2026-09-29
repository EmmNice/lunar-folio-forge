import { createStart, createMiddleware, createCsrfMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

/**
 * Origins allowed to invoke server functions.
 *
 * createCsrfMiddleware validates Sec-Fetch-Site first, then Origin, then
 * Referer. The Origin and Referer branches compare against
 * `new URL(request.url).origin`, which behind a reverse proxy is the *internal*
 * origin rather than the public one — so both fallbacks always fail.
 *
 * Current browsers send `Sec-Fetch-Site: same-origin` and are unaffected, which
 * is what hid this. Clients that omit the header (older Safari, some in-app
 * webviews) were getting 403 from every server function. Supplying the public
 * origin explicitly makes the fallbacks correct without loosening anything:
 * cross-site requests and foreign origins are still rejected.
 */
function allowedOrigins(): string[] {
  const origins = new Set<string>();

  for (const value of [process.env.APP_URL, process.env.VITE_APP_URL]) {
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      console.error(`[csrf] Ignoring unparseable APP_URL: ${value}`);
    }
  }

  // Railway exposes the public hostname without a scheme.
  const railwayHost = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railwayHost) origins.add(`https://${railwayHost}`);

  return [...origins];
}

// Protect server functions from cross-site request forgery.
// Only applies to serverFn handler type — not SSR or API routes.
//
// An empty array is truthy to the middleware and would reject every Origin, so
// pass undefined instead and let it fall back to its own comparison.
const csrfOrigins = allowedOrigins();
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
  origin: csrfOrigins.length > 0 ? csrfOrigins : undefined,
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));

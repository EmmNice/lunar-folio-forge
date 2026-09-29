import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-DNS-Prefetch-Control": "on",
};

let cachedCsp: string | undefined;

/**
 * Content-Security-Policy for SSR responses.
 *
 * Built once per process because it depends on SUPABASE_URL — preferable to
 * hardcoding a `*.supabase.co` wildcard that would break on a custom domain.
 *
 * Two deliberate relaxations:
 *   - script-src allows 'unsafe-inline' because TanStack Start emits the
 *     hydration payload as an inline <script>. Tightening this needs per-request
 *     nonces threaded through the SSR renderer.
 *   - img-src allows any https origin: avatars come from GitHub, Google, X and
 *     Supabase storage, and the card exporter reads blob/data URLs.
 *
 * Note this only covers responses that pass through this handler. Nitro serves
 * files from public/ before the handler runs, so those get no CSP — fine, since
 * the policy is about what a document is allowed to load.
 */
function contentSecurityPolicy(): string {
  if (cachedCsp) return cachedCsp;

  const supabaseOrigins = new Set<string>();
  for (const value of [process.env.SUPABASE_URL, process.env.VITE_SUPABASE_URL]) {
    if (!value) continue;
    try {
      const { origin, host } = new URL(value);
      supabaseOrigins.add(origin);
      supabaseOrigins.add(`wss://${host}`);
    } catch {
      console.error(`[security] Ignoring unparseable Supabase URL: ${value}`);
    }
  }

  // The card exporter has to fetch() the Google Fonts stylesheet to inline the
  // webfont into the PNG. Reading it via CSSOM is blocked by the same-origin
  // policy, so html-to-image falls back to fetching the text -- and connect-src
  // was refusing that, which meant every export logged a CSP violation and the
  // saved card rendered in a fallback system font instead of Inter. These are the
  // same two origins style-src and font-src already trust to render the page, so
  // naming them here grants nothing new.
  const connectSrc = [
    "'self'",
    ...supabaseOrigins,
    "https://fonts.googleapis.com",
    "https://fonts.gstatic.com",
  ].join(" ");

  cachedCsp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  return cachedCsp;
}

function applySecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  if (!headers.has("Content-Security-Policy")) {
    headers.set("Content-Security-Policy", contentSecurityPolicy());
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response);
      return applySecurityHeaders(normalized);
    } catch (error) {
      console.error(error);
      const errResponse = new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
      return applySecurityHeaders(errResponse);
    }
  },
};

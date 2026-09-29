/**
 * External error reporting.
 *
 * Speaks Sentry's envelope protocol over `fetch` rather than pulling in
 * `@sentry/node` and `@sentry/react`. That is a deliberate trade, and worth
 * stating plainly:
 *
 *   What this gives you — errors with stack traces, release and environment
 *   tags, the request URL, a server/browser tag, and scrubbing of anything that
 *   looks like a credential. Works with Sentry itself and with any
 *   envelope-compatible host (GlitchTip, Bugsink). Costs the browser bundle
 *   nothing at all when no DSN is configured, because there is no SDK to ship.
 *
 *   What it does not give you — automatic breadcrumbs, session replay,
 *   performance tracing, and source-map symbolication of minified frames. If
 *   those become worth the bundle weight, swap this module for the official SDKs;
 *   the call sites (`reportError`) stay the same.
 *
 * Disabled unless a DSN is present, and never throws: a reporting failure must
 * not become a second error on top of the one being reported.
 */

export type ErrorContext = {
  /** Where this came from, e.g. "ssr", "serverFn:submitPitch", "stripe-webhook". */
  source: string;
  url?: string;
  userId?: string;
  extra?: Record<string, string | number | boolean | null>;
};

type ParsedDsn = {
  endpoint: string;
  publicKey: string;
};

/**
 * A Sentry DSN is https://<publicKey>@<host>/<projectId>. The ingest endpoint is
 * derived from it rather than configured separately, so there is one thing to set.
 */
function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "");
    if (!url.username || !projectId) return null;
    return {
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
      publicKey: url.username,
    };
  } catch {
    return null;
  }
}

/**
 * Origin the envelope POST goes to, or null if the DSN is unusable.
 *
 * The browser's report is a cross-origin `fetch`, so this origin has to appear in
 * the `connect-src` of the CSP in server.ts or the report is blocked before it is
 * sent — and a blocked error report is indistinguishable from no errors.
 */
export function dsnOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  const parsed = parseDsn(dsn);
  if (!parsed) return null;
  try {
    return new URL(parsed.endpoint).origin;
  } catch {
    return null;
  }
}

/** Anything matching these never leaves the process. */
const SENSITIVE_KEY =
  /token|secret|password|authorization|apikey|api_key|cookie|session|bearer|dsn|signature/i;

/**
 * Redacts credential-shaped values from a string.
 *
 * Stack traces and error messages pick up query strings and header values, and
 * this app handles a Supabase service-role key, a Stripe secret and a webhook
 * signing secret. Sending any of those to a third party would be worse than the
 * bug being reported.
 */
export function scrub(input: string): string {
  return (
    input
      // key=value pairs in query strings and log lines
      .replace(
        /\b([A-Za-z_]*(?:token|secret|password|key|signature)[A-Za-z_]*)=([^\s&"']+)/gi,
        "$1=[redacted]",
      )
      // bearer tokens
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
      // JWTs anywhere
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, "[redacted-jwt]")
      // provider key formats used in this project
      .replace(
        /\b(sb_secret_|sb_publishable_|sbp_|sk_live_|sk_test_|whsec_|re_)[A-Za-z0-9_-]+/g,
        "$1[redacted]",
      )
  );
}

function scrubExtra(
  extra: Record<string, string | number | boolean | null> | undefined,
): Record<string, string | number | boolean | null> {
  if (!extra) return {};
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(extra)) {
    out[key] = SENSITIVE_KEY.test(key)
      ? "[redacted]"
      : typeof value === "string"
        ? scrub(value)
        : value;
  }
  return out;
}

function normaliseError(error: unknown): { type: string; value: string; stack?: string } {
  if (error instanceof Error) {
    return {
      type: error.name || "Error",
      value: scrub(error.message || String(error)),
      stack: error.stack ? scrub(error.stack) : undefined,
    };
  }
  return {
    type: "UnknownError",
    value: scrub(typeof error === "string" ? error : JSON.stringify(error)),
  };
}

/**
 * Turns a stack string into Sentry frames.
 *
 * Deliberately simple — enough for the "which file and line" question, which is
 * what a stack is usually read for. Minified frames stay minified; see the note
 * at the top of this file.
 */
function framesFromStack(stack: string | undefined) {
  if (!stack) return undefined;
  const frames = stack
    .split("\n")
    .slice(1)
    .map((line) => {
      const match = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
      if (!match) return null;
      return {
        function: match[1] ?? "?",
        filename: match[2],
        lineno: Number(match[3]),
        colno: Number(match[4]),
      };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null)
    // Sentry renders frames oldest-first.
    .reverse();
  return frames.length > 0 ? { values: frames } : undefined;
}

export type MonitoringConfig = {
  dsn?: string;
  release?: string;
  environment?: string;
  runtime: "server" | "browser";
};

let config: MonitoringConfig | null = null;
let ambientUserId: string | undefined;

export function initMonitoring(next: MonitoringConfig) {
  config = next;
}

/**
 * Who is signed in, for reports that have no per-request context.
 *
 * On the server the user is a property of the request and is passed to
 * `reportError` directly. In the browser there is only ever one user, so the
 * alternative would be threading an id into every `window.onerror` call site.
 */
export function setMonitoringUser(userId: string | undefined) {
  ambientUserId = userId;
}

export function monitoringEnabled(): boolean {
  return Boolean(config?.dsn && parseDsn(config.dsn));
}

/**
 * Sends one error. Fire-and-forget: callers must not await this on a request path.
 */
export function reportError(error: unknown, context: ErrorContext): void {
  if (!config?.dsn) return;
  const dsn = parseDsn(config.dsn);
  if (!dsn) return;

  try {
    const { type, value, stack } = normaliseError(error);
    const eventId = crypto.randomUUID().replace(/-/g, "");
    const timestamp = new Date().toISOString();

    const event = {
      event_id: eventId,
      timestamp,
      platform: "javascript",
      level: "error",
      logger: context.source,
      release: config.release,
      environment: config.environment ?? "production",
      server_name: undefined,
      tags: {
        runtime: config.runtime,
        source: context.source,
      },
      // Only the id, never an email or handle. Enough to see whether one account
      // is hitting something without shipping a user table to a third party.
      user: (() => {
        const id = context.userId ?? ambientUserId;
        return id ? { id } : undefined;
      })(),
      request: context.url ? { url: scrub(context.url) } : undefined,
      extra: scrubExtra(context.extra),
      exception: {
        values: [{ type, value, stacktrace: framesFromStack(stack) }],
      },
    };

    const body =
      JSON.stringify({ event_id: eventId, sent_at: timestamp }) +
      "\n" +
      JSON.stringify({ type: "event" }) +
      "\n" +
      JSON.stringify(event);

    void fetch(dsn.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=the-ledger/1.0`,
      },
      body,
      // Must never hold a response open or surface a failure of its own.
      keepalive: config.runtime === "browser",
    }).catch(() => {});
  } catch {
    // Reporting must never throw.
  }
}

/**
 * Server-side runtime configuration.
 *
 * Only import this from inside a server function handler (a lazy `await import`
 * keeps it out of the client bundle, same as client.server.ts).
 *
 * Everything here reads from the environment. There are deliberately no
 * fallbacks to production hostnames or Resend's sandbox domain: a staging
 * deploy that forgets a variable should fail loudly rather than email real
 * users from, or link them to, the wrong environment.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Set it in your deployment environment (see .env.example).`,
    );
  }
  return value;
}

/** Public base URL of this deployment, with any trailing slash removed. */
export function appUrl(): string {
  return required("APP_URL").replace(/\/+$/, "");
}

/** Absolute URL for a path within the app, for use in transactional emails. */
export function appLink(path: string): string {
  return `${appUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Verified Resend sender, e.g. `The Ledger <noreply@yourdomain.com>`.
 * The domain must be verified in Resend or delivery will fail.
 */
export function mailFrom(): string {
  return required("RESEND_FROM_EMAIL");
}

/** Resend API key, or null when email delivery is not configured. */
export function resendApiKey(): string | null {
  return process.env.RESEND_API_KEY ?? null;
}

/**
 * Stripe webhook endpoint.
 *
 * Lives outside the router and is dispatched from src/server.ts before the
 * request reaches TanStack Start, for two reasons:
 *
 *   1. Signature verification needs the exact bytes Stripe sent. Anything that
 *      parses or re-serialises the body first invalidates the signature.
 *   2. It is not a server function, so it must not be subject to the CSRF origin
 *      check — Stripe is a third party posting from its own infrastructure and has
 *      no Origin header to offer.
 *
 * This is the only path that grants entitlements. A member cannot reach it
 * usefully: without a valid `stripe-signature` computed with the endpoint secret,
 * every request is rejected before anything is read.
 */

import type Stripe from "stripe";
import { reportError } from "./monitoring";

/** Events this endpoint acts on. Anything else is acknowledged and ignored. */
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export const STRIPE_WEBHOOK_PATH = "/api/stripe/webhook";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handleStripeWebhook(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const { getStripe, stripeSecretKey, stripeWebhookSecret } = await import("./billing.server");

  const secret = stripeWebhookSecret();
  if (!stripeSecretKey() || !secret) {
    // 503 rather than 404: the endpoint exists, this deployment just has no
    // billing configured. Saying so makes a misconfigured Stripe dashboard
    // obvious in its delivery log instead of looking like a routing bug.
    console.error("[billing] Webhook received but STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET unset.");
    return json(503, { error: "Billing is not configured" });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return json(400, { error: "Missing stripe-signature header" });

  // Raw text, before anything else touches it.
  const payload = await request.text();

  const stripe = await getStripe();
  let event: Stripe.Event;
  try {
    // Async variant: uses Web Crypto, so this stays correct if the server ever
    // runs somewhere without Node's synchronous crypto.
    event = await stripe.webhooks.constructEventAsync(payload, signature, secret);
  } catch (error) {
    // Deliberately terse, and a 400 so Stripe does not retry: a bad signature is
    // either a misconfigured secret or a forgery, and neither improves on retry.
    console.error(
      `[billing] Rejected webhook: ${error instanceof Error ? error.message : "bad signature"}`,
    );
    return json(400, { error: "Invalid signature" });
  }

  if (!HANDLED.has(event.type)) {
    // 200, or Stripe will retry an event we are never going to act on.
    return json(200, { received: true, ignored: event.type });
  }

  const { claimBillingEvent, releaseBillingEvent } = await import("./billing.server");

  const claimed = await claimBillingEvent(event.id, event.type, event.data.object);
  if (!claimed) {
    return json(200, { received: true, duplicate: true });
  }

  try {
    await processEvent(stripe, event);
    return json(200, { received: true });
  } catch (error) {
    await releaseBillingEvent(event.id);
    console.error(`[billing] Failed to handle ${event.type} (${event.id}):`, error);
    reportError(error, {
      source: "stripe-webhook",
      extra: { eventType: event.type, eventId: event.id },
    });
    // 500 so Stripe retries with backoff.
    return json(500, { error: "Handler failed" });
  }
}

async function processEvent(stripe: Stripe, event: Stripe.Event): Promise<void> {
  const { applySubscription } = await import("./billing.server");

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const subscriptionId =
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

    // A one-off payment has no subscription; nothing to record.
    if (!subscriptionId) return;

    // Re-fetch rather than trusting the session's embedded copy: the session is a
    // snapshot from when checkout started, and the subscription is the object that
    // carries the live status and period.
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await applySubscription(subscription);
    return;
  }

  // created / updated / deleted all carry the subscription itself, already
  // reflecting the change — including 'deleted', where status is 'canceled'.
  const subscription = event.data.object as Stripe.Subscription;
  await applySubscription(subscription);
}

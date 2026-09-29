/**
 * Stripe integration. Server-only — never import this from a route or a
 * *.functions.ts module's top level, both of which ship to the browser.
 *
 * Shape of the integration: Stripe is the source of truth, and the database is a
 * cache of it. Nothing here decides whether a subscription is active; it records
 * what Stripe said and then asks the database to derive
 * `profiles.subscription_status` from those rows via sync_subscription_status().
 * That is why there is no "mark this user as paid" function — a local write that
 * Stripe did not authorise is exactly the drift this arrangement prevents.
 *
 * The whole module is inert without STRIPE_SECRET_KEY. `billingConfigured()` is
 * what the UI asks so an unpriced deployment shows an honest "checkout isn't set
 * up" instead of a button that throws.
 */

import type Stripe from "stripe";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Pinned deliberately, and it must stay in step with the installed SDK.
 *
 * In this version Stripe moved the billing period off the subscription and onto
 * each subscription item. Reading `subscription.current_period_end` — which every
 * older integration does — now yields undefined rather than failing, so pinning
 * the version is what keeps `snapshotFromStripe` below honest.
 */
const STRIPE_API_VERSION = "2025-08-27.basil" as const;

export function stripeSecretKey(): string | null {
  return process.env.STRIPE_SECRET_KEY ?? null;
}

export function stripePriceId(): string | null {
  return process.env.STRIPE_PRICE_ID ?? null;
}

export function stripeWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET ?? null;
}

/** True when checkout can actually be started: a key and something to sell. */
export function billingConfigured(): boolean {
  return Boolean(stripeSecretKey() && stripePriceId());
}

let clientPromise: Promise<Stripe> | null = null;

/** Lazily constructed so importing this module costs nothing when unconfigured. */
export async function getStripe(): Promise<Stripe> {
  const key = stripeSecretKey();
  if (!key) {
    throw new Error("Billing is not configured on this deployment.");
  }
  if (!clientPromise) {
    clientPromise = import("stripe").then(
      (m) =>
        new m.default(key, {
          apiVersion: STRIPE_API_VERSION,
          typescript: true,
          appInfo: { name: "The Ledger" },
        }),
    );
  }
  return clientPromise;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

/**
 * The member's Stripe customer id, creating it on first use.
 *
 * `billing_customers.user_id` is the primary key and `stripe_customer_id` is
 * unique, so two concurrent checkout clicks cannot leave one member owning two
 * Stripe customers — the loser of the race re-reads the winner's row instead of
 * inserting. Without that, a member could end up with two subscriptions billed in
 * parallel and only one of them visible.
 */
export async function ensureStripeCustomer(userId: string, email: string | null): Promise<string> {
  const existing = await supabaseAdmin
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data.stripe_customer_id;

  const stripe = await getStripe();
  const customer = await stripe.customers.create({
    email: email ?? undefined,
    // Lets the webhook attribute an event even if the local row is somehow missing.
    metadata: { supabase_user_id: userId },
  });

  const inserted = await supabaseAdmin
    .from("billing_customers")
    .insert({ user_id: userId, stripe_customer_id: customer.id })
    .select("stripe_customer_id")
    .maybeSingle();

  if (inserted.error) {
    // 23505 = another request inserted the row first. Theirs is as good as ours;
    // adopt it and abandon the customer we just made rather than failing checkout.
    if (inserted.error.code === "23505") {
      const winner = await supabaseAdmin
        .from("billing_customers")
        .select("stripe_customer_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (winner.data) return winner.data.stripe_customer_id;
    }
    throw new Error(inserted.error.message);
  }

  return customer.id;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

function toIso(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number") return null;
  return new Date(seconds * 1000).toISOString();
}

type SubscriptionRow = {
  id: string;
  user_id: string;
  status: string;
  price_id: string | null;
  quantity: number;
  cancel_at_period_end: boolean;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  canceled_at: string | null;
  updated_at: string;
};

/**
 * Flattens a Stripe subscription into the row shape billing_subscriptions wants.
 *
 * `status` is stored in Stripe's own vocabulary rather than mapped here — the
 * table has a CHECK constraint listing all eight values, so a status Stripe adds
 * in future fails loudly on write instead of being quietly filed as 'free'.
 */
export function snapshotFromStripe(sub: Stripe.Subscription, userId: string): SubscriptionRow {
  // See STRIPE_API_VERSION: the period lives on the item in this API version.
  const item = sub.items?.data?.[0];

  return {
    id: sub.id,
    user_id: userId,
    status: sub.status,
    price_id: item?.price?.id ?? null,
    quantity: item?.quantity ?? 1,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    current_period_start: toIso(item?.current_period_start),
    current_period_end: toIso(item?.current_period_end),
    trial_end: toIso(sub.trial_end),
    canceled_at: toIso(sub.canceled_at),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Which member a Stripe subscription belongs to.
 *
 * Checks the metadata we set at checkout first, then falls back to the customer
 * mapping. Returns null rather than guessing: attributing a payment to the wrong
 * account is worse than dropping the event and logging it.
 */
export async function resolveUserId(sub: Stripe.Subscription): Promise<string | null> {
  const fromMetadata = sub.metadata?.supabase_user_id;
  if (fromMetadata) return fromMetadata;

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) return null;

  const { data } = await supabaseAdmin
    .from("billing_customers")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.user_id ?? null;
}

/**
 * Records a subscription and re-derives the member's entitlement.
 *
 * Upsert on the Stripe subscription id, so a webhook Stripe redelivers writes the
 * same row rather than a duplicate. sync_subscription_status() then recomputes
 * profiles.subscription_status from *all* of the member's subscription rows, which
 * is what stops one cancelled subscription from revoking access that a second,
 * active one still grants.
 */
export async function applySubscription(sub: Stripe.Subscription): Promise<string | null> {
  const userId = await resolveUserId(sub);
  if (!userId) {
    console.error(`[billing] No user for Stripe subscription ${sub.id}; skipping.`);
    return null;
  }

  const row = snapshotFromStripe(sub, userId);
  const upsert = await supabaseAdmin
    .from("billing_subscriptions")
    .upsert(row, { onConflict: "id" });
  if (upsert.error) throw new Error(upsert.error.message);

  const synced = await supabaseAdmin.rpc("sync_subscription_status", { _user_id: userId });
  if (synced.error) throw new Error(synced.error.message);

  return userId;
}

// ---------------------------------------------------------------------------
// Webhook idempotency
// ---------------------------------------------------------------------------

/**
 * Claims one Stripe event id, returning false if it was already handled.
 *
 * Stripe retries deliveries and will happily send the same event twice. The
 * insert is the lock: billing_events.id is the primary key, so the second
 * delivery loses on a unique violation and is skipped. This is what stops a
 * redelivered `customer.subscription.deleted` from cancelling a subscription the
 * member has since renewed.
 */
export async function claimBillingEvent(
  id: string,
  type: string,
  payload: unknown,
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("billing_events")
    .insert({ id, type, payload: payload as never });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(error.message);
}

/**
 * Gives an event id back after a failed attempt, so Stripe's retry can re-run it.
 *
 * Without this, claiming the id up front would turn any transient failure —
 * a dropped database connection mid-handler — into a permanently skipped event,
 * because every retry would be rejected as a duplicate. Claim first to stop
 * concurrent redelivery, release on failure so a retry still has a way in.
 */
export async function releaseBillingEvent(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from("billing_events").delete().eq("id", id);
  if (error) {
    // Logged, not thrown: the caller is already handling a failure and this is a
    // best-effort cleanup. Worst case the event is skipped, which is what would
    // have happened anyway.
    console.error(`[billing] Couldn't release event ${id}: ${error.message}`);
  }
}

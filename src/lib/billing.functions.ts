import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Checkout and subscription management.
 *
 * Every Stripe call lives server-side: the secret key never reaches the browser,
 * and the price being bought is read from the environment rather than accepted
 * from the client. Letting the client name a price id is the classic way to sell
 * a $200/mo plan for $1 — there is deliberately no parameter for it here.
 *
 * None of these mark anybody as subscribed. Entitlement changes only ever arrive
 * through the webhook in src/server.ts, which is the only path Stripe has
 * actually signed.
 */

export type BillingOverview = {
  /** False when the deployment has no Stripe key or price; the UI says so plainly. */
  configured: boolean;
  /** Derived column on profiles: free | active | past_due | canceled. */
  status: string;
  /** True once the member has a Stripe customer, i.e. the portal is reachable. */
  hasCustomer: boolean;
  subscription: {
    status: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
    trialEnd: string | null;
  } | null;
};

/**
 * What the /billing screen renders.
 *
 * Reads the subscription through the caller's own client, so the select-own RLS
 * policy on billing_subscriptions is what scopes it — this function cannot be
 * tricked into showing somebody else's plan because it never takes a user id.
 */
export const getBillingOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BillingOverview> => {
    const { supabase, userId } = context;
    const { billingConfigured } = await import("./billing.server");

    const [profile, subscription, customer] = await Promise.all([
      supabase.rpc("current_profile").maybeSingle(),
      supabase
        .from("billing_subscriptions")
        .select("status, cancel_at_period_end, current_period_end, trial_end")
        // Newest first: a member who resubscribed after cancelling has two rows,
        // and the older cancelled one is not the one to show them.
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("billing_customers").select("user_id").eq("user_id", userId).maybeSingle(),
    ]);

    const status =
      (profile.data as { subscription_status?: string | null } | null)?.subscription_status ??
      "free";

    return {
      configured: billingConfigured(),
      status,
      hasCustomer: Boolean(customer.data),
      subscription: subscription.data
        ? {
            status: subscription.data.status,
            cancelAtPeriodEnd: subscription.data.cancel_at_period_end,
            currentPeriodEnd: subscription.data.current_period_end,
            trialEnd: subscription.data.trial_end,
          }
        : null,
    };
  });

/**
 * Opens a Stripe Checkout session for the configured price.
 *
 * A suspended account cannot start one. Taking money from someone who cannot post
 * is a refund request waiting to happen, and account_status is not readable by
 * `authenticated`, so the check has to happen here with the admin client.
 */
export const startCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ url: string }> => {
    const { userId, claims } = context;
    const { billingConfigured, ensureStripeCustomer, getStripe, stripePriceId } =
      await import("./billing.server");

    if (!billingConfigured()) {
      throw new Error("Billing isn't set up on this deployment yet.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { appLink } = await import("./app-config.server");

    const { data: me, error: meError } = await supabaseAdmin
      .from("profiles")
      .select("id, account_status, subscription_status")
      .eq("id", userId)
      .maybeSingle();
    if (meError) throw new Error(meError.message);
    if (!me) throw new Error("Your profile is not set up yet.");
    if (me.account_status !== "active") {
      throw new Error("Your account can't start a subscription right now.");
    }
    if (me.subscription_status === "active") {
      throw new Error("You're already subscribed. Manage your plan from the billing portal.");
    }

    const email = typeof claims.email === "string" ? claims.email : null;
    const customerId = await ensureStripeCustomer(userId, email);
    const stripe = await getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: stripePriceId()!, quantity: 1 }],
      // Both of these ride on the subscription so the webhook can attribute the
      // event even if the billing_customers row is somehow missing.
      client_reference_id: userId,
      subscription_data: { metadata: { supabase_user_id: userId } },
      success_url: appLink("/billing?checkout=success"),
      cancel_url: appLink("/billing?checkout=cancelled"),
      allow_promotion_codes: true,
    });

    if (!session.url) throw new Error("Stripe didn't return a checkout URL.");
    return { url: session.url };
  });

/**
 * Stripe's hosted billing portal — card changes, invoices, cancellation.
 *
 * Cancelling is deliberately not reimplemented here: Stripe's portal already does
 * it, handles proration and dunning, and stays correct as their API moves.
 */
export const openBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ url: string }> => {
    const { supabase } = context;
    const { getStripe, stripeSecretKey } = await import("./billing.server");

    if (!stripeSecretKey()) {
      throw new Error("Billing isn't set up on this deployment yet.");
    }

    // Select-own RLS: this can only ever find the caller's own customer row.
    const { data, error } = await supabase
      .from("billing_customers")
      .select("stripe_customer_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("You don't have a billing account yet.");

    const { appLink } = await import("./app-config.server");
    const stripe = await getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: appLink("/billing"),
    });

    return { url: session.url };
  });

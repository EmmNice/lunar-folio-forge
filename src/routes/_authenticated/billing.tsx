import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, CreditCard, Loader2, Sparkles, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ErrorState } from "@/components/states";
import {
  getBillingOverview,
  openBillingPortal,
  startCheckout,
  type BillingOverview,
} from "@/lib/billing.functions";
import { DAILY_AI_CREDITS } from "@/lib/limits";

const CHECKOUT_OUTCOMES = ["success", "cancelled"] as const;

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({ meta: [{ title: "Billing · The Ledger" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    checkout: CHECKOUT_OUTCOMES.find((c) => c === search.checkout),
  }),
  component: BillingPage,
});

/** How `profiles.subscription_status` reads to a human. */
const STATUS_COPY: Record<string, { label: string; tone: string; detail: string }> = {
  free: {
    label: "Free",
    tone: "var(--text-secondary)",
    detail: `You get ${DAILY_AI_CREDITS} PulseAssist requests a day.`,
  },
  active: {
    label: "Active",
    tone: "#34d399",
    detail: "PulseAssist is uncapped on your account.",
  },
  past_due: {
    label: "Payment retrying",
    tone: "#fbbf24",
    detail:
      "Your last payment didn't go through and Stripe is retrying it. Your access continues in the meantime — updating your card is the fastest way to clear this.",
  },
  canceled: {
    label: "Cancelled",
    tone: "var(--text-secondary)",
    detail: `Your subscription has ended, so PulseAssist is back to ${DAILY_AI_CREDITS} requests a day.`,
  },
};

function BillingPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { checkout } = Route.useSearch();

  const loadOverview = useServerFn(getBillingOverview);
  const checkoutFn = useServerFn(startCheckout);
  const portalFn = useServerFn(openBillingPortal);

  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoadError(null);
    try {
      setOverview(await loadOverview());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load your billing details.");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
    Report the outcome of a Stripe redirect, then drop the parameter.

    The status shown may still say "Free" for a second or two after a successful
    checkout: entitlement is granted by the webhook, not by this redirect, and
    Stripe's delivery races the browser coming back. Saying so is better than
    showing a stale "Free" with no explanation — and far better than trusting the
    redirect and granting access here, which anyone could then do by visiting a URL.
  */
  useEffect(() => {
    if (!checkout) return;
    if (checkout === "success") {
      toast.success("Payment received. Your plan updates as soon as Stripe confirms it.");
    } else {
      toast.info("Checkout cancelled — nothing was charged.");
    }
    navigate({ to: "/billing", search: { checkout: undefined }, replace: true });
  }, [checkout, navigate]);

  const status = overview?.status ?? profile?.subscription_status ?? "free";
  const copy = STATUS_COPY[status] ?? STATUS_COPY.free;
  const isPaid = status === "active" || status === "past_due";

  async function upgrade() {
    setBusy(true);
    try {
      const { url } = await checkoutFn();
      // Full navigation, not the router: this leaves the app for Stripe's domain.
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start checkout.");
      setBusy(false);
    }
  }

  async function manage() {
    setBusy(true);
    try {
      const { url } = await portalFn();
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open the billing portal.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen" style={{ background: "#0B0B0C" }}>
      <div
        className="flex items-center gap-3 px-4 py-4"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <button type="button" onClick={() => navigate({ to: "/feed" })} className="btn-icon">
          <ArrowLeft className="h-5 w-5 text-muted-foreground" />
        </button>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-tertiary">
            Account
          </p>
          <h1 className="text-[17px] font-semibold tracking-tight">Billing</h1>
        </div>
      </div>

      <main className="mx-auto max-w-lg px-4 pb-28 pt-8">
        {loadError && (
          <div className="mb-5">
            <ErrorState message={loadError} onRetry={refresh} />
          </div>
        )}

        {/* Current plan */}
        <div
          className="rounded-2xl p-5"
          style={{
            border: "1px solid rgba(255,255,255,0.07)",
            background: "rgba(26,26,30,0.60)",
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-tertiary">
                Current plan
              </p>
              <p className="mt-1 text-lg font-semibold" style={{ color: copy.tone }}>
                {overview === null && !loadError ? "…" : copy.label}
              </p>
            </div>
            {status === "past_due" && (
              <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-amber-400" />
            )}
          </div>

          <p className="mt-2 text-[13px] leading-relaxed text-secondary">{copy.detail}</p>

          {overview?.subscription ? (
            <dl
              className="mt-4 space-y-1.5 border-t pt-3 text-[12px]"
              style={{ borderColor: "var(--border)" }}
            >
              {overview.subscription.trialEnd &&
              new Date(overview.subscription.trialEnd) > new Date() ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-tertiary">Trial ends</dt>
                  <dd className="tabular-nums">{formatDate(overview.subscription.trialEnd)}</dd>
                </div>
              ) : null}
              {overview.subscription.currentPeriodEnd ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-tertiary">
                    {overview.subscription.cancelAtPeriodEnd ? "Access ends" : "Renews"}
                  </dt>
                  <dd className="tabular-nums">
                    {formatDate(overview.subscription.currentPeriodEnd)}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          {overview?.subscription?.cancelAtPeriodEnd ? (
            <p
              className="mt-3 rounded-lg px-3 py-2 text-[12px] leading-relaxed text-amber-300"
              style={{ background: "rgba(251,191,36,0.08)" }}
            >
              Your subscription is set to end at the close of this period. You keep access until
              then, and you can resume it from the billing portal.
            </p>
          ) : null}
        </div>

        {/* What it buys — stated plainly, and only what is actually true. */}
        {!isPaid && (
          <div
            className="mt-5 rounded-2xl p-5"
            style={{
              border: "1px solid rgba(251,191,36,0.22)",
              background: "rgba(251,191,36,0.05)",
            }}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" style={{ color: "var(--gold)" }} />
              <h2 className="text-sm font-semibold">Uncapped PulseAssist</h2>
            </div>
            <ul className="mt-3 space-y-2">
              {[
                `Unlimited PulseAssist drafts and chat, instead of ${DAILY_AI_CREDITS} a day.`,
                "Cancel whenever you like, from Stripe's billing portal.",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2 text-[13px] leading-relaxed">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--gold)" }} />
                  <span className="text-secondary">{line}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] leading-relaxed text-tertiary">
              Verification is separate and always free — a Silver or Gold badge already includes
              uncapped PulseAssist, so subscribe only if you would rather not wait to be verified.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="mt-5 space-y-2">
          {overview && !overview.configured ? (
            /* Honest about an unconfigured deployment rather than showing a button
               that can only fail. */
            <div
              className="rounded-xl p-4 text-[12px] leading-relaxed text-muted-foreground"
              style={{ border: "1px dashed rgba(255,255,255,0.12)" }}
            >
              <p className="font-medium text-secondary">Checkout isn't available yet.</p>
              <p className="mt-1">
                This deployment has no payment provider configured, so there is nothing to buy right
                now. Everything else on The Ledger works as normal, and verification still grants
                uncapped PulseAssist for free.
              </p>
            </div>
          ) : isPaid || overview?.hasCustomer ? (
            <button
              type="button"
              onClick={manage}
              disabled={busy || overview === null}
              className="btn btn-outline btn-block"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="h-4 w-4" />
              )}
              Manage billing
            </button>
          ) : (
            <button
              type="button"
              onClick={upgrade}
              disabled={busy || overview === null}
              className="btn btn-primary btn-block"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Upgrade
            </button>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-tertiary">
          Payments are handled by Stripe. Card details never reach The Ledger.
        </p>
      </main>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

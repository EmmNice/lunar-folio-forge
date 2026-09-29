import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { VerificationSection } from "@/components/VerificationPortal";

export const Route = createFileRoute("/_authenticated/verification")({
  // Stripe sends the member back here with ?fee=paid or ?fee=cancelled. Validated
  // rather than read raw, so the banner cannot be driven by an arbitrary value.
  validateSearch: (search: Record<string, unknown>) => ({
    fee: search.fee === "paid" || search.fee === "cancelled" ? search.fee : undefined,
  }),
  head: () => ({ meta: [{ title: "Verification · The Ledger" }] }),
  component: VerificationPage,
});

/**
 * A page for applying for a badge.
 *
 * The portal previously had no address at all: it was rendered inside the
 * Edit-profile sheet, underneath the Save button of a form about your bio, and
 * that was the only way to reach it. So "where do I apply for verification?" had
 * no answer you could give someone, and no link you could send them. It does now.
 */
function VerificationPage() {
  const { profile, loading } = useAuth();
  const { fee } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();

  /*
    Stripe's redirect is a hint, not proof. Payment is recorded by the webhook, so
    "paid" here says the checkout page finished rather than that the money arrived —
    which is why it points at the panel below instead of claiming the application is
    now in the queue.
  */
  const feeNotice =
    fee === "paid" ? (
      <div
        className="mb-5 rounded-xl px-4 py-3 text-[12px]"
        style={{
          background: "rgba(34,197,94,0.07)",
          border: "1px solid rgba(34,197,94,0.22)",
          color: "#4ade80",
        }}
      >
        Payment received. Your application status is below — it updates as soon as Stripe confirms.
      </div>
    ) : fee === "cancelled" ? (
      <div
        className="mb-5 rounded-xl px-4 py-3 text-[12px]"
        style={{
          background: "rgba(251,191,36,0.06)",
          border: "1px solid rgba(251,191,36,0.20)",
          color: "#fbbf24",
        }}
      >
        Checkout was cancelled. Your answers are saved — you can finish paying below.
      </div>
    ) : null;

  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-20 backdrop-blur-xl"
        style={{
          background: "rgba(11,11,12,0.92)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3.5 sm:px-6">
          {/*
            Goes back where you came from, rather than always to /settings.

            This page is reached from a profile far more often than from settings —
            the "Get verified" button lives next to Edit profile — so a hardcoded
            settings link sent people somewhere they had never been. Falls back to
            the member's own profile when there is no history to go back to, which
            is the case on a cold load of a shared link.
          */}
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) router.history.back();
              else if (profile)
                navigate({
                  to: "/u/$handle",
                  params: { handle: profile.handle },
                  search: { tab: undefined },
                });
              else navigate({ to: "/feed" });
            }}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            style={{ background: "rgba(255,255,255,0.06)" }}
            aria-label="Go back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] font-semibold text-foreground">Verification</h1>
            <p className="truncate text-[11px] text-muted-foreground">
              Prove who you are and get a badge
            </p>
          </div>
          <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
        {/*
          What a badge does, and what it costs. Deliberately not what it requires:
          the requirements appear once somebody has said which they are, so the
          choice is made on identity rather than on whichever checklist looks
          shortest.
        */}
        <div
          className="mb-6 space-y-2 rounded-2xl p-5"
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <p className="text-[13px] leading-relaxed text-secondary">
            A badge decides where your posts appear and who can reach you. Verified builders show up
            in Signal, and Gold members get the Whisper audience and a pitch inbox.
          </p>
          <p className="text-[12px] leading-relaxed text-tertiary">
            It costs <span className="font-semibold text-secondary">$1</span> to apply, either
            badge. That pays for the review, not the outcome. Tell us which you are below and we'll
            show you what's needed.
          </p>
        </div>

        {feeNotice}

        {loading ? (
          <div className="space-y-3">
            <div className="h-10 animate-pulse rounded-xl bg-white/[0.04]" />
            <div className="h-40 animate-pulse rounded-2xl bg-white/[0.04]" />
          </div>
        ) : profile ? (
          <VerificationSection profile={profile} />
        ) : (
          <p className="text-sm text-muted-foreground">Your profile could not be loaded.</p>
        )}
      </main>
    </div>
  );
}

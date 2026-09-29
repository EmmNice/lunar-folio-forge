import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { VerificationSection } from "@/components/VerificationPortal";

export const Route = createFileRoute("/_authenticated/verification")({
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
          <Link
            to="/settings"
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            style={{ background: "rgba(255,255,255,0.06)" }}
            aria-label="Back to settings"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
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
        {/* What the badges are for, before the form asks for anything. */}
        <div
          className="mb-6 space-y-3 rounded-2xl p-5"
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <p className="text-[13px] leading-relaxed text-secondary">
            A badge is not decoration — it decides where your posts appear and who can reach you.
          </p>
          <ul className="space-y-2.5 text-[12px] leading-relaxed text-tertiary">
            <li>
              <span className="font-medium text-secondary">Silver — for builders.</span> Developers,
              startup teams, designers, indie hackers: anyone shipping. You need a GitHub profile
              and one thing you have actually built — a live URL or a deployed contract. Your posts
              then appear in Signal, and PulseAssist stops counting your credits.
            </li>
            <li>
              <span className="font-medium text-secondary">Gold — two ways in.</span>
              <span className="mt-1 block">
                <span className="font-medium text-secondary">Founders and operators</span> who have
                launched something with real users and real transactions. Not an idea, not a
                waitlist — a product people use, with somewhere public a reviewer can see that.
              </span>
              <span className="mt-1 block">
                <span className="font-medium text-secondary">Backers</span> — funds, angels and
                companies that invest.
              </span>
              <span className="mt-1 block">
                Either way: Signal visibility, the Whisper audience, and a pitch inbox other members
                can reach.
              </span>
            </li>
          </ul>
          <p className="text-[12px] leading-relaxed text-tertiary">
            Every track asks you to publish a short code where only the real owner could put it —
            your GitHub bio, or the site you are claiming. That is the part a reviewer cannot check
            by eye, and it is what stops somebody applying with a link to your work.
          </p>
        </div>

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

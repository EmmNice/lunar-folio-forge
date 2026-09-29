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
          <ul className="space-y-2 text-[12px] leading-relaxed text-tertiary">
            <li>
              <span className="font-medium text-secondary">Silver — for builders who ship.</span>{" "}
              Your posts appear in Signal alongside the rest of the verified feed, and PulseAssist
              stops counting your credits.
            </li>
            <li>
              <span className="font-medium text-secondary">
                Gold — for investors, funds and companies.
              </span>{" "}
              Signal visibility, the Whisper audience, and a pitch inbox other members can reach.
            </li>
          </ul>
          <p className="text-[12px] leading-relaxed text-tertiary">
            Both tracks ask you to publish a short code where only the real owner of the account
            could put it. That is the part a human reviewer cannot check by eye, and it is what
            keeps somebody from applying with a link to your GitHub.
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

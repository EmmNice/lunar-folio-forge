import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import {
  Rss,
  PenSquare,
  ShieldCheck,
  MessageSquare,
  Lock,
  Zap,
  Loader2,
  ChevronDown,
  ChevronUp,
  Mail,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatusCard } from "@/components/StatusCard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "The Ledger — A high-signal network for tech founders" },
      {
        name: "description",
        content:
          "The Ledger: a premium, elite platform for Web3 builders, founders, and investors. Publish status updates, export share-ready graphics, get verified.",
      },
    ],
  }),
  component: Landing,
});

const BENTO_CARDS = [
  {
    icon: Rss,
    headline: "Signal & Beat Feeds",
    desc: "Signal surfaces only verified builders. Beat is the raw, chronological pulse of everything shipping.",
    wide: true,
  },
  {
    icon: Zap,
    headline: "PulseAssist AI",
    desc: "Draft, polish, and sharpen your posts with an elite AI co-writer built for high-signal founders.",
    wide: false,
  },
  {
    icon: PenSquare,
    headline: "Workspace Studio",
    desc: "Craft 1080×1920 status cards ready for WhatsApp Status or your socials — exported in one click.",
    wide: false,
  },
  {
    icon: ShieldCheck,
    headline: "Silver & Gold Verification",
    desc: "Earn your badge. Silver for recognized builders. Gold for elite founders with real traction.",
    wide: false,
  },
  {
    icon: Lock,
    headline: "Elite Privacy Controls",
    desc: "Post to verified audiences only, disable comments, and gate your content from noise.",
    wide: false,
  },
  {
    icon: MessageSquare,
    headline: "Gated Direct Messages",
    desc: "Verified builders send structured pitch requests. Signal without the spam.",
    wide: false,
  },
];

// GitHub SVG icon
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

// Google SVG icon
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

// X (Twitter) SVG icon
function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.259 5.631 5.905-5.631zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

type AuthView = "social" | "email-signin" | "email-signup" | "check-email";

function Landing() {
  const navigate = useNavigate();
  const [view, setView] = useState<AuthView>("social");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null); // tracks which button
  const [confirmEmail, setConfirmEmail] = useState(""); // email shown on check-email screen

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/feed", replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) navigate({ to: "/feed", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  /* ── OAuth sign-in ── */
  async function signInWithProvider(provider: "github" | "google" | "twitter") {
    setSubmitting(provider);
    const redirectTo = `${window.location.origin}/feed`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });
    if (error) {
      toast.error(
        error.message.includes("provider is not enabled") || error.message.includes("not enabled")
          ? `${provider.charAt(0).toUpperCase() + provider.slice(1)} sign-in isn't enabled yet in Supabase — enable it in your project's Auth Providers settings.`
          : error.message,
      );
    }
    setSubmitting(null);
  }

  /* ── Email sign-in ── */
  async function handleEmailSignIn(e: FormEvent) {
    e.preventDefault();
    if (!email || !password) { toast.error("Enter your email and password."); return; }
    setSubmitting("email-signin");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(null);
    if (!error) { navigate({ to: "/feed", replace: true }); return; }
    if (error.message.toLowerCase().includes("not confirmed") || error.message.toLowerCase().includes("email not confirmed")) {
      setConfirmEmail(email);
      setView("check-email");
    } else if (error.message.toLowerCase().includes("invalid login") || error.message.toLowerCase().includes("invalid credentials")) {
      toast.error("Incorrect email or password. Try again or create an account.");
    } else {
      toast.error(error.message);
    }
  }

  /* ── Email sign-up ── */
  async function handleEmailSignUp(e: FormEvent) {
    e.preventDefault();
    if (!email || !password) { toast.error("Enter your email and password."); return; }
    if (password.length < 8) { toast.error("Password must be at least 8 characters."); return; }
    setSubmitting("email-signup");
    const { data, error } = await supabase.auth.signUp({ email, password });
    setSubmitting(null);
    if (error) {
      if (error.message.toLowerCase().includes("already registered") || error.message.toLowerCase().includes("already exists")) {
        toast.error("An account with this email already exists. Sign in instead.");
        setView("email-signin");
      } else {
        toast.error(error.message);
      }
      return;
    }
    if (data.session) {
      navigate({ to: "/feed", replace: true });
    } else {
      setConfirmEmail(email);
      setView("check-email");
    }
  }

  /* ── Resend confirmation ── */
  async function resendConfirmation() {
    if (!confirmEmail) return;
    setSubmitting("resend");
    const { error } = await supabase.auth.resend({ type: "signup", email: confirmEmail });
    setSubmitting(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Confirmation email resent — check your inbox.");
  }

  /* ── Magic link (passwordless) ── */
  async function sendMagicLink(e: FormEvent) {
    e.preventDefault();
    if (!email) { toast.error("Enter your email address."); return; }
    setSubmitting("magic");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/feed` },
    });
    setSubmitting(null);
    if (error) { toast.error(error.message); return; }
    setConfirmEmail(email);
    setView("check-email");
  }

  const field =
    "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none ring-offset-background focus-visible:ring-1 focus-visible:ring-ring transition-colors";

  const providerBtn = (busy: boolean) =>
    "relative flex w-full items-center gap-3 rounded-xl border border-border/70 bg-card/60 px-4 py-3 text-sm font-medium text-foreground transition-all hover:border-border hover:bg-card disabled:opacity-60";

  /* ── Auth card content ── */
  function AuthCard() {
    if (view === "check-email") {
      return (
        <div className="text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-border bg-secondary/60">
            <Mail className="h-5 w-5 text-muted-foreground" />
          </div>
          <h2 className="text-base font-semibold">Check your email</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            We sent a link to <span className="font-medium text-foreground">{confirmEmail}</span>.
            Click it to sign in — then come back here.
          </p>
          <div className="mt-5 space-y-2.5">
            <button
              type="button"
              onClick={resendConfirmation}
              disabled={submitting === "resend"}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-3 text-sm font-medium text-foreground transition-all hover:bg-card disabled:opacity-60"
            >
              {submitting === "resend" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Resend confirmation email
            </button>
            <button
              type="button"
              onClick={() => { setView("social"); setConfirmEmail(""); }}
              className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline transition-colors"
            >
              ← Back to sign in
            </button>
          </div>
        </div>
      );
    }

    if (view === "email-signin") {
      return (
        <div>
          <h2 className="mb-4 text-center text-base font-semibold">Sign in with email</h2>
          <form onSubmit={handleEmailSignIn} className="space-y-3">
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className={field} required />
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className={field} required />
            <button
              type="submit"
              disabled={submitting !== null}
              className="w-full rounded-xl bg-foreground py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {submitting === "email-signin" ? <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Signing in…</span> : "Sign in"}
            </button>
          </form>
          <div className="mt-4 space-y-2 text-center text-xs text-muted-foreground">
            <p>
              No account?{" "}
              <button type="button" onClick={() => setView("email-signup")} className="font-medium text-foreground underline-offset-4 hover:underline">
                Create one
              </button>
            </p>
            <button type="button" onClick={() => setView("social")} className="hover:text-foreground hover:underline underline-offset-4">
              ← Other sign-in options
            </button>
          </div>
        </div>
      );
    }

    if (view === "email-signup") {
      return (
        <div>
          <h2 className="mb-4 text-center text-base font-semibold">Create account</h2>
          <form onSubmit={handleEmailSignUp} className="space-y-3">
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className={field} required />
            <div className="space-y-1">
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (8+ characters)" className={field} minLength={8} required />
              <p className="px-0.5 text-xs text-muted-foreground">Use a unique password — avoid simple or common ones.</p>
            </div>
            <button
              type="submit"
              disabled={submitting !== null}
              className="w-full rounded-xl bg-foreground py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {submitting === "email-signup" ? <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Creating…</span> : "Create account"}
            </button>
          </form>
          <div className="mt-4 space-y-2 text-center text-xs text-muted-foreground">
            <p>
              Already have an account?{" "}
              <button type="button" onClick={() => setView("email-signin")} className="font-medium text-foreground underline-offset-4 hover:underline">
                Sign in
              </button>
            </p>
            <button type="button" onClick={() => setView("social")} className="hover:text-foreground hover:underline underline-offset-4">
              ← Other sign-in options
            </button>
          </div>
        </div>
      );
    }

    /* ── Default: social-first ── */
    return (
      <div className="space-y-2.5">
        {/* GitHub — most authentic for dev/founder identity */}
        <button
          type="button"
          onClick={() => signInWithProvider("github")}
          disabled={submitting !== null}
          className={providerBtn(submitting === "github")}
        >
          {submitting === "github" ? <Loader2 className="h-5 w-5 animate-spin shrink-0" /> : <GitHubIcon className="h-5 w-5 shrink-0" />}
          <span className="flex-1 text-left">Continue with GitHub</span>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">Builders</span>
        </button>

        {/* Google */}
        <button
          type="button"
          onClick={() => signInWithProvider("google")}
          disabled={submitting !== null}
          className={providerBtn(submitting === "google")}
        >
          {submitting === "google" ? <Loader2 className="h-5 w-5 animate-spin shrink-0" /> : <GoogleIcon className="h-5 w-5 shrink-0" />}
          <span className="flex-1 text-left">Continue with Google</span>
        </button>

        {/* X / Twitter — Web3 native */}
        <button
          type="button"
          onClick={() => signInWithProvider("twitter")}
          disabled={submitting !== null}
          className={providerBtn(submitting === "twitter")}
        >
          {submitting === "twitter" ? <Loader2 className="h-5 w-5 animate-spin shrink-0" /> : <XIcon className="h-5 w-5 shrink-0" />}
          <span className="flex-1 text-left">Continue with X</span>
          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-400">Web3</span>
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 py-1">
          <div className="h-px flex-1 bg-border/60" />
          <span className="text-[11px] text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border/60" />
        </div>

        {/* Email options */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setView("email-signin")}
            className="rounded-xl border border-border/70 bg-card/40 px-3 py-2.5 text-xs font-medium text-muted-foreground transition-all hover:border-border hover:text-foreground"
          >
            Sign in with email
          </button>
          <button
            type="button"
            onClick={() => setView("email-signup")}
            className="rounded-xl border border-border/70 bg-card/40 px-3 py-2.5 text-xs font-medium text-muted-foreground transition-all hover:border-border hover:text-foreground"
          >
            Create account
          </button>
        </div>

        <p className="pt-1 text-center text-[11px] leading-relaxed text-muted-foreground/70">
          By signing in you agree to The Ledger's{" "}
          <Link to="/feed" className="underline underline-offset-2 hover:text-muted-foreground">terms</Link>.
          A high-signal network — real identity required.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* ── Nav ── */}
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/70 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md border border-border bg-secondary/60 text-xs font-semibold">
              L
            </span>
            <span className="text-sm font-semibold tracking-tight">The Ledger</span>
          </div>
          <Link
            to="/feed"
            className="rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Explore Feed →
          </Link>
        </div>
      </header>

      <main>
        {/* ── Hero + auth card ── */}
        <section className="mx-auto max-w-5xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            {/* Left: copy */}
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                A high-signal network for builders
              </p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl xl:text-6xl">
                Ship your thoughts<br /> like you ship code.
              </h1>
              <p className="mt-5 max-w-md text-base text-muted-foreground">
                A premium, tech-noir platform for Web3 builders, founders, and investors.
                One global timeline — no follower games, just signal.
              </p>

              {/* Social proof / feature pills */}
              <div className="mt-7 flex flex-wrap gap-2">
                {[
                  "GitHub verified identity",
                  "Signal & Beat feeds",
                  "Silver & Gold badges",
                  "PulseAssist AI",
                  "WhatsApp status cards",
                ].map((label) => (
                  <span
                    key={label}
                    className="rounded-full border border-border/60 bg-secondary/30 px-3 py-1 text-xs text-muted-foreground"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {/* Right: auth card */}
            <div className="mx-auto w-full max-w-sm">
              <div className="rounded-2xl border border-slate-800/70 bg-card/50 p-6 shadow-xl shadow-black/30 backdrop-blur">
                {view === "social" && (
                  <p className="mb-5 text-center text-sm font-medium text-foreground">
                    Join The Ledger
                  </p>
                )}
                <AuthCard />
              </div>
            </div>
          </div>
        </section>

        {/* ── Demo card ── */}
        <section className="mx-auto max-w-xs px-4 pb-12 sm:max-w-sm">
          <StatusCard
            name="Aria Stone"
            handle="ariastone"
            content={`Building quiet infra with loud ambition.\n\nNotes from the workshop, shipped daily.`}
            verificationTier="gold"
          />
        </section>

        {/* ── Bento grid ── */}
        <section className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
          <p className="mb-6 text-center text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Everything on the platform
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {BENTO_CARDS.map((card, i) => (
              <div
                key={card.headline}
                className={`rounded-2xl border border-slate-800/60 bg-card/40 p-5 transition-colors hover:border-slate-700/70 hover:bg-card/60 ${
                  i === 0 ? "sm:col-span-2 lg:col-span-2" : ""
                }`}
              >
                <card.icon className="mb-3 h-5 w-5 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">{card.headline}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{card.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

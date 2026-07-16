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
    span: true,
  },
  {
    icon: Zap,
    headline: "PulseAssist AI",
    desc: "Draft, polish, and sharpen your posts with an elite AI co-writer built for high-signal founders.",
  },
  {
    icon: PenSquare,
    headline: "Workspace Studio",
    desc: "Craft 1080×1920 status cards ready for WhatsApp Status or your socials — exported in one click.",
  },
  {
    icon: ShieldCheck,
    headline: "Silver & Gold Verification",
    desc: "Earn your badge. Silver for recognized builders. Gold for elite founders with real traction.",
  },
  {
    icon: Lock,
    headline: "Elite Privacy Controls",
    desc: "Post to verified audiences only, disable comments, and gate your content from noise.",
  },
  {
    icon: MessageSquare,
    headline: "Gated Direct Messages",
    desc: "3 new DMs per day for unverified users. Verified builders send structured pitch requests.",
  },
];

function Landing() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    // Redirect already-authenticated users immediately — no loading gate.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/feed", replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) navigate({ to: "/feed", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Enter an email and password.");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "sign-up") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) { toast.error(error.message); return; }
        if (data.session) {
          navigate({ to: "/feed", replace: true });
        } else {
          toast.success("Account created — check your email to confirm, then sign in.");
          setMode("sign-in");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { toast.error(error.message); return; }
        navigate({ to: "/feed", replace: true });
      }
    } finally {
      setSubmitting(false);
    }
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
        {/* ── Hero ── */}
        <section className="mx-auto max-w-5xl px-4 pb-16 pt-20 text-center sm:px-6 sm:pt-28">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
            A high-signal network for builders
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">
            Ship your thoughts<br className="hidden sm:block" /> like you ship code.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
            A premium, tech-noir platform for Web3 builders, founders, and investors.
            One global timeline — no follower games, just signal.
          </p>

          {/* ── Auth card ── */}
          <div className="mx-auto mt-10 max-w-sm">
            <form
              onSubmit={handleSubmit}
              className="rounded-2xl border border-slate-800/70 bg-card/50 p-6 shadow-xl shadow-black/20 backdrop-blur"
            >
              <div className="mb-5 flex gap-1 rounded-lg bg-muted p-1 text-sm">
                <button
                  type="button"
                  onClick={() => setMode("sign-in")}
                  className={`flex-1 rounded-md py-1.5 font-medium transition-colors ${
                    mode === "sign-in" ? "bg-background shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => setMode("sign-up")}
                  className={`flex-1 rounded-md py-1.5 font-medium transition-colors ${
                    mode === "sign-up" ? "bg-background shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  Create account
                </button>
              </div>

              <div className="space-y-3">
                <div className="text-left">
                  <label className="block text-xs font-medium text-muted-foreground">Email</label>
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="text-left">
                  <label className="block text-xs font-medium text-muted-foreground">Password</label>
                  <input
                    type="password"
                    autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    minLength={6}
                    className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="mt-5 w-full rounded-lg bg-foreground py-2.5 text-sm font-medium text-background shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Please wait…
                  </span>
                ) : mode === "sign-up" ? "Create account" : "Sign in"}
              </button>

              <Link
                to="/feed"
                className="mt-4 block text-center text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Peek at The Ledger →
              </Link>
            </form>
          </div>
        </section>

        {/* ── Demo card ── */}
        <section className="mx-auto max-w-xs px-4 pb-12 sm:max-w-sm">
          <StatusCard
            name="Aria Stone"
            title="Founder & CEO, Nimbus Cloud"
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
                  card.span ? "sm:col-span-2 lg:col-span-1" : ""
                } ${i === 0 ? "lg:col-span-2" : ""}`}
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

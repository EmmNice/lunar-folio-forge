import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { StatusCard } from "@/components/StatusCard";
import { AppHeader } from "@/components/AppHeader";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "The Ledger — a high-signal network for tech founders" },
      {
        name: "description",
        content:
          "The Ledger: a professional network for verified tech founders. Publish status updates to a global feed, and export share-ready graphics for WhatsApp Status.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checkedSession, setCheckedSession] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        navigate({ to: "/feed", replace: true });
      } else {
        setCheckedSession(true);
      }
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
        if (error) {
          toast.error(error.message);
          return;
        }
        if (data.session) {
          navigate({ to: "/feed", replace: true });
        } else {
          toast.success("Account created — check your email to confirm, then sign in.");
          setMode("sign-in");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          toast.error(error.message);
          return;
        }
        navigate({ to: "/feed", replace: true });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!checkedSession) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-6 pt-16 pb-24">
        <div className="grid items-center gap-16 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
              A high-signal network for builders
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
              Ship your thoughts like you ship code.
            </h1>
            <p className="mt-5 max-w-lg text-base text-muted-foreground sm:text-lg">
              A single global timeline for verified tech founders — no follower games,
              just signal. Write a punchy 280-character note, publish it live, or export
              a crisp 1080×1920 card for WhatsApp Status.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 max-w-sm rounded-xl border border-border bg-card/50 p-5">
              <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1 text-sm">
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

              <label className="block text-xs font-medium text-muted-foreground">Email</label>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              />

              <label className="mt-3 block text-xs font-medium text-muted-foreground">Password</label>
              <input
                type="password"
                autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              />

              <button
                type="submit"
                disabled={submitting}
                className="mt-4 w-full rounded-lg bg-foreground py-2.5 text-sm font-medium text-background shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? "Please wait…" : mode === "sign-up" ? "Create account" : "Sign in"}
              </button>

              <Link
                to="/feed"
                className="mt-4 block text-center text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Peek at The Ledger →
              </Link>
            </form>

            <ul className="mt-10 grid gap-2 text-sm text-muted-foreground">
              <li>· Email &amp; password sign-in — no third-party account required</li>
              <li>· One global Explore Feed — chronological, no follower graph</li>
              <li>· Workspace Studio with live preview + 1080×1920 PNG export</li>
              <li>· Silver &amp; Gold verification for recognized builders and elite founders</li>
              <li>· Direct messages, gated to keep the inbox clean</li>
            </ul>
          </div>

          <div className="mx-auto w-full max-w-[300px]">
            <StatusCard
              name="Aria Stone"
              title="Founder & CEO, Nimbus Cloud"
              handle="ariastone"
              content={`Building quiet infra with loud ambition.\n\nNotes from the workshop, shipped daily.`}
              verificationTier="gold"
            />
          </div>
        </div>
      </main>
    </div>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { StatusCard } from "@/components/StatusCard";
import { AppHeader } from "@/components/AppHeader";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Godson — Status Studio for tech founders" },
      {
        name: "description",
        content:
          "Design and share tech-founder status cards. Sign in with Google to publish to The Ledger and export images for WhatsApp Status.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [signingIn, setSigningIn] = useState(false);
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

  async function handleGoogle() {
    setSigningIn(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error(result.error.message || "Sign-in failed. Try again.");
      setSigningIn(false);
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/feed", replace: true });
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
              A status studio for builders
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
              Ship your thoughts like you ship code.
            </h1>
            <p className="mt-5 max-w-lg text-base text-muted-foreground sm:text-lg">
              Write a punchy 280-character note, pick your background, and export
              a crisp 1080×1920 card for WhatsApp Status — or publish it to The
              Ledger, a global feed of tech founders.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleGoogle}
                disabled={signingIn}
                className="inline-flex items-center gap-3 rounded-lg bg-foreground px-5 py-3 text-sm font-medium text-background shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                <GoogleGlyph />
                {signingIn ? "Redirecting…" : "Continue with Google"}
              </button>
              <Link
                to="/feed"
                className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Peek at The Ledger →
              </Link>
            </div>

            <ul className="mt-10 grid gap-2 text-sm text-muted-foreground">
              <li>· Google sign-in — no passwords, uses your name and avatar</li>
              <li>· Personal Studio with live preview + 1080×1920 PNG export</li>
              <li>· Publish to a real-time public feed</li>
              <li>· Direct messages, gated to keep the inbox clean</li>
            </ul>
          </div>

          <div className="mx-auto w-full max-w-[300px]">
            <StatusCard
              name="Godson Chukwuemeka"
              title="Tech Founder"
              handle="godson"
              content={`Building quiet software with loud ambition.\n\nNotes from the workshop, shipped daily.`}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

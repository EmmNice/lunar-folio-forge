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
  Mail,
  RefreshCw,
  ArrowRight,
  Check,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatusCard } from "@/components/StatusCard";
import { LedgerMark } from "@/components/AppHeader";
import { MIN_PASSWORD_LENGTH } from "@/lib/limits";
import { passwordProblem } from "@/lib/password";
import { UsernameField } from "@/components/UsernameField";
import {
  checkUsername,
  describeUsernameError,
  slugifyUsername,
  USERNAME_HINT,
  USERNAME_MIN,
  type UsernameState,
} from "@/lib/username";
import { PasswordRequirements } from "@/components/PasswordRequirements";

// Terms live outside the app. Set VITE_TERMS_URL to link them from the consent
// line; when it's unset the sentence renders as plain text rather than pointing
// somewhere that isn't the terms.
const TERMS_URL = import.meta.env.VITE_TERMS_URL as string | undefined;

// Which OAuth providers to offer, comma separated, e.g. "github,google,twitter".
//
// A provider has to be enabled in Supabase (Authentication -> Providers) before
// it belongs here: listing one that is not configured renders a button that can
// only ever produce an error toast. Defaults to none, so the card shows email
// sign-in only until real OAuth credentials exist.
const ENABLED_OAUTH_PROVIDERS = new Set(
  ((import.meta.env.VITE_AUTH_PROVIDERS as string | undefined) ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean),
);
const HAS_OAUTH = ENABLED_OAUTH_PROVIDERS.size > 0;

export const Route = createFileRoute("/")({
  ssr: false, // auth is client-only; disable SSR to prevent hydration mismatches
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
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
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

type AuthView =
  | "social"
  | "email-signin"
  | "email-signup"
  | "check-email"
  | "forgot-password"
  | "reset-link-sent";

function Landing() {
  const navigate = useNavigate();
  const [view, setView] = useState<AuthView>("social");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [username, setUsername] = useState("");
  const [usernameState, setUsernameState] = useState<UsernameState>({ status: "empty" });

  /*
    Where profiles actually live, read from the browser rather than hardcoded.

    Set in an effect rather than during render because this component is
    server-rendered: reading window during SSR would throw, and reading it in the
    initial client render would produce markup that disagrees with the server's.
    Empty on the first pass, filled immediately after mount.
  */
  const [profileUrlPrefix, setProfileUrlPrefix] = useState("");
  useEffect(() => {
    setProfileUrlPrefix(`${window.location.host}/u/`);
  }, []);

  useEffect(() => {
    // A recovery link normally lands on /reset-password, because that is the
    // redirectTo we ask for. But if the URL ever falls back to the project's Site
    // URL -- an allow-list that does not cover the path, or a link generated
    // elsewhere such as the Supabase dashboard -- it arrives here instead. Without
    // this branch, detectSessionInUrl would quietly establish the recovery
    // session, the redirect below would send the member to /feed, and the one
    // thing they came to do would be impossible.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search);
    const isRecovery = hash.get("type") === "recovery" || query.get("type") === "recovery";

    if (isRecovery) {
      navigate({ to: "/reset-password", replace: true });
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/feed", replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        navigate({ to: "/reset-password", replace: true });
        return;
      }
      if (event === "SIGNED_IN" && session) navigate({ to: "/feed", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  /* OAuth sign-in */
  async function signInWithProvider(provider: "github" | "google" | "twitter") {
    setSubmitting(provider);
    const redirectTo = `${window.location.origin}/feed`;
    // skipBrowserRedirect: true — Supabase JS fetches the auth URL first instead of
    // immediately navigating. This lets us catch "provider not enabled" errors in JS
    // before the browser ends up on a raw JSON error page.
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) {
      const label =
        provider === "twitter"
          ? "X / Twitter"
          : provider.charAt(0).toUpperCase() + provider.slice(1);
      toast.error(
        error.message.toLowerCase().includes("not enabled") ||
          error.message.toLowerCase().includes("validation_failed")
          ? `${label} sign-in isn't enabled on this server yet.`
          : error.message,
      );
      setSubmitting(null);
      return;
    }
    // No error — navigate to the OAuth page manually
    if (data?.url) {
      window.location.href = data.url;
    } else {
      setSubmitting(null);
    }
  }

  /* Email sign-in */
  async function handleEmailSignIn(e: FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Enter your email and password.");
      return;
    }
    setSubmitting("email-signin");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(null);
    if (!error) {
      navigate({ to: "/feed", replace: true });
      return;
    }
    if (
      error.message.toLowerCase().includes("not confirmed") ||
      error.message.toLowerCase().includes("email not confirmed")
    ) {
      setConfirmEmail(email);
      setView("check-email");
    } else if (
      error.message.toLowerCase().includes("invalid login") ||
      error.message.toLowerCase().includes("invalid credentials")
    ) {
      toast.error("Incorrect email or password. Try again or create an account.");
    } else {
      toast.error(error.message);
    }
  }

  /**
   * Email sign-up.
   *
   * The username is collected here and passed through `options.data`, which lands
   * in `raw_user_meta_data` for the `handle_new_user` trigger to read. Before this,
   * signup asked only for an email and password and the trigger built a handle out
   * of the email's local part — so people ended up publicly identified by the front
   * half of their email address without ever being asked.
   *
   * A taken name makes the trigger raise, which rolls the whole signup back. That
   * is deliberate: no account should exist in a half-named state, and the
   * alternative (quietly appending a digit) hands someone an identity they never
   * chose and cannot easily undo.
   */
  async function handleEmailSignUp(e: FormEvent) {
    e.preventDefault();
    const desiredUsername = slugifyUsername(username);

    if (!desiredUsername || !email || !password) {
      toast.error("Choose a username and enter your email and password.");
      return;
    }
    if (desiredUsername.length < USERNAME_MIN) {
      toast.error(USERNAME_HINT);
      return;
    }
    if (usernameState.status === "unavailable") {
      toast.error(usernameState.message);
      return;
    }
    const problem = passwordProblem(password);
    if (problem) {
      toast.error(`Password needs: ${problem.toLowerCase()}.`);
      return;
    }

    setSubmitting("email-signup");
    // Re-checked immediately before submitting. The live check debounces, so a fast
    // typist can reach this button while the answer for their final keystroke is
    // still in flight.
    const finalCheck = await checkUsername(desiredUsername);
    if (finalCheck.status === "unavailable") {
      setSubmitting(null);
      setUsernameState(finalCheck);
      toast.error(finalCheck.message);
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/feed`,
        data: { username: desiredUsername },
      },
    });
    setSubmitting(null);
    if (error) {
      if (
        error.message.toLowerCase().includes("already registered") ||
        error.message.toLowerCase().includes("already exists")
      ) {
        toast.error("An account with this email already exists. Sign in instead.");
        setView("email-signin");
      } else {
        toast.error(describeUsernameError(error.message));
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

  /**
   * Send a password-reset link.
   *
   * There was no way to do this at all before: no resetPasswordForEmail call, no
   * "Forgot password?" link and no route to land on, so anyone who forgot their
   * password was permanently locked out of their account with no self-service
   * path back in.
   *
   * The response is deliberately not conditional on whether the address exists.
   * Saying "no account with that email" would turn this form into a way to test
   * whether any given person is a member.
   */
  async function handleForgotPassword(e: FormEvent) {
    e.preventDefault();
    if (!email) {
      toast.error("Enter your email address.");
      return;
    }
    setSubmitting("forgot-password");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(null);
    if (error) {
      // Rate limiting is the one failure worth showing, because waiting is the
      // fix and silence would just make people hammer the button.
      toast.error(
        error.message.toLowerCase().includes("rate")
          ? "Too many attempts. Wait a minute and try again."
          : error.message,
      );
      return;
    }
    setConfirmEmail(email);
    setView("reset-link-sent");
  }

  /* Resend confirmation */
  async function resendConfirmation() {
    if (!confirmEmail) return;
    setSubmitting("resend");
    const { error } = await supabase.auth.resend({ type: "signup", email: confirmEmail });
    setSubmitting(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Confirmation email resent — check your inbox.");
  }

  const inputCls = "field";

  const providerBtnCls =
    "btn btn-outline btn-block justify-start gap-3 !px-4 text-[15px] font-medium";

  /*  Render auth card content inline (NOT as a nested component — doing so
        causes React to unmount/remount the entire subtree on every state change,
        making buttons appear unresponsive)  */
  const authCardContent = (() => {
    if (view === "forgot-password") {
      return (
        <div>
          <h2 className="mb-1.5 text-center text-base font-semibold">Reset your password</h2>
          <p className="mb-4 text-center text-sm text-muted-foreground">
            We'll email you a link to set a new one.
          </p>
          <form onSubmit={handleForgotPassword} className="space-y-3">
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className={inputCls}
              required
            />
            <button
              type="submit"
              disabled={submitting !== null}
              className="btn btn-primary btn-block"
            >
              {submitting === "forgot-password" ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending…
                </span>
              ) : (
                "Send reset link"
              )}
            </button>
          </form>
          <button
            type="button"
            onClick={() => setView("email-signin")}
            className="mt-4 w-full text-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline transition-colors"
          >
            ← Back to sign in
          </button>
        </div>
      );
    }

    if (view === "reset-link-sent") {
      return (
        <div className="text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-border bg-secondary/60">
            <Mail className="h-5 w-5 text-muted-foreground" />
          </div>
          <h2 className="text-base font-semibold">Check your email</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            If <span className="font-medium text-foreground">{confirmEmail}</span> has an account, a
            password reset link is on its way. The link expires in one hour.
          </p>
          <button
            type="button"
            onClick={() => {
              setView("email-signin");
              setConfirmEmail("");
            }}
            className="mt-5 w-full text-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline transition-colors"
          >
            ← Back to sign in
          </button>
        </div>
      );
    }

    if (view === "check-email") {
      return (
        <div className="text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-border bg-secondary/60">
            <Mail className="h-5 w-5 text-muted-foreground" />
          </div>
          <h2 className="text-base font-semibold">Check your email</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            We sent a link to <span className="font-medium text-foreground">{confirmEmail}</span>.
            Click it to finish signing in.
          </p>
          <div className="mt-5 space-y-2.5">
            <button
              type="button"
              onClick={resendConfirmation}
              disabled={submitting === "resend"}
              className="btn btn-outline btn-block"
            >
              {submitting === "resend" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Resend confirmation email
            </button>
            <button
              type="button"
              onClick={() => {
                setView("social");
                setConfirmEmail("");
              }}
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
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className={inputCls}
              required
            />
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className={inputCls}
              required
            />
            <button
              type="submit"
              disabled={submitting !== null}
              className="btn btn-primary btn-block"
            >
              {submitting === "email-signin" ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in…
                </span>
              ) : (
                "Sign in"
              )}
            </button>
          </form>
          <div className="mt-4 space-y-2 text-center text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => setView("forgot-password")}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Forgot your password?
            </button>
            <p>
              No account?{" "}
              <button
                type="button"
                onClick={() => setView("email-signup")}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Create one
              </button>
            </p>
            <button
              type="button"
              onClick={() => setView("social")}
              className="hover:text-foreground hover:underline underline-offset-4"
            >
              ← Other sign-in options
            </button>
          </div>
        </div>
      );
    }

    if (view === "email-signup") {
      return (
        <div>
          <h2 className="mb-1 text-center text-base font-semibold">Create your account</h2>
          {/* The host is read from the browser, not written into the bundle. This
              line used to promise "theledger.app/u/yourname" — a domain the app is
              not actually served from, so the first thing a new account was told
              about its own address was wrong. Falls back to a plain phrasing during
              SSR, where there is no location to read. */}
          <p className="mb-4 text-center text-xs leading-relaxed text-tertiary">
            {profileUrlPrefix ? (
              <>
                Your username is how people find you: {profileUrlPrefix}
                <span className="text-secondary">{slugifyUsername(username) || "yourname"}</span>
              </>
            ) : (
              <>Your username is how people find you — it becomes your profile address.</>
            )}
          </p>
          <form onSubmit={handleEmailSignUp} className="space-y-3">
            {/* First field, because it is the identity decision — the rest is just
                credentials. It is also the only one that can be taken. */}
            <UsernameField
              value={username}
              onChange={setUsername}
              onStateChange={setUsernameState}
              autoFocus
              disabled={submitting !== null}
            />
            <div className="space-y-1.5">
              <label
                htmlFor="signup-email"
                className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary"
              >
                Email
              </label>
              <input
                id="signup-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className={inputCls}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="signup-password"
                className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary"
              >
                Password
              </label>
              <input
                id="signup-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                className={inputCls}
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
              <PasswordRequirements value={password} />
            </div>
            <button
              type="submit"
              disabled={
                submitting !== null ||
                usernameState.status === "checking" ||
                usernameState.status === "unavailable" ||
                usernameState.status === "too-short" ||
                usernameState.status === "empty"
              }
              className="btn btn-primary btn-block"
            >
              {submitting === "email-signup" ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating account…
                </span>
              ) : (
                "Create account"
              )}
            </button>
          </form>
          <div className="mt-4 space-y-2 text-center text-xs text-muted-foreground">
            <p>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => setView("email-signin")}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Sign in
              </button>
            </p>
            <button
              type="button"
              onClick={() => setView("social")}
              className="hover:text-foreground hover:underline underline-offset-4"
            >
              ← Other sign-in options
            </button>
          </div>
        </div>
      );
    }

    /* Default: OAuth when configured, otherwise email-only */
    return (
      <div className="space-y-2.5">
        {/* GitHub */}
        {ENABLED_OAUTH_PROVIDERS.has("github") && (
          <button
            type="button"
            onClick={() => signInWithProvider("github")}
            disabled={submitting !== null}
            className={providerBtnCls}
          >
            {submitting === "github" ? (
              <Loader2 className="h-5 w-5 animate-spin shrink-0" />
            ) : (
              <GitHubIcon className="h-5 w-5 shrink-0" />
            )}
            <span className="flex-1 text-left">Continue with GitHub</span>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
              Builders
            </span>
          </button>
        )}

        {/* Google */}
        {ENABLED_OAUTH_PROVIDERS.has("google") && (
          <button
            type="button"
            onClick={() => signInWithProvider("google")}
            disabled={submitting !== null}
            className={providerBtnCls}
          >
            {submitting === "google" ? (
              <Loader2 className="h-5 w-5 animate-spin shrink-0" />
            ) : (
              <GoogleIcon className="h-5 w-5 shrink-0" />
            )}
            <span className="flex-1 text-left">Continue with Google</span>
          </button>
        )}

        {/* X / Twitter */}
        {ENABLED_OAUTH_PROVIDERS.has("twitter") && (
          <button
            type="button"
            onClick={() => signInWithProvider("twitter")}
            disabled={submitting !== null}
            className={providerBtnCls}
          >
            {submitting === "twitter" ? (
              <Loader2 className="h-5 w-5 animate-spin shrink-0" />
            ) : (
              <XIcon className="h-5 w-5 shrink-0" />
            )}
            <span className="flex-1 text-left">Continue with X</span>
            <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-400">
              Web3
            </span>
          </button>
        )}

        {/* Divider — only meaningful when OAuth buttons are shown above */}
        {HAS_OAUTH && (
          <div className="flex items-center gap-3 py-1">
            <div className="h-px flex-1 bg-border/60" />
            <span className="text-[11px] text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border/60" />
          </div>
        )}

        {/* Email options */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setView("email-signin")}
            className="btn btn-outline btn-sm"
          >
            Sign in with email
          </button>
          <button
            type="button"
            onClick={() => setView("email-signup")}
            className="btn btn-outline btn-sm"
          >
            Create account
          </button>
        </div>

        <p className="pt-1 text-center text-[11px] leading-relaxed text-tertiary">
          By signing in you agree to The Ledger's{" "}
          {TERMS_URL ? (
            <a
              href={TERMS_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 hover:text-muted-foreground"
            >
              terms
            </a>
          ) : (
            "terms"
          )}
          . A high-signal network — real identity required.
        </p>
      </div>
    );
  })();

  return (
    <div className="min-h-screen">
      {/*
        The old hero put the auth card in a narrow top-right column and pushed the
        product preview into its own full-width section far below, which left a
        large empty band down the middle of the page at desktop widths. The card
        now sits opposite the copy as a real second column, and the preview gets a
        framed section of its own with a heading, instead of floating unlabelled.
      */}
      <header className="sticky top-0 z-40 border-b glass" style={{ borderColor: "var(--border)" }}>
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <LedgerMark className="h-5 w-auto" />
            <span className="text-[15px] font-semibold tracking-tight">The Ledger</span>
          </div>
          <Link to="/feed" className="btn btn-ghost btn-sm">
            Explore the feed
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      <main>
        {/* ── Hero ── */}
        <section className="mx-auto max-w-6xl px-4 pb-20 pt-14 sm:px-6 sm:pb-24 sm:pt-20">
          <div className="grid items-start gap-12 lg:grid-cols-[1.05fr_minmax(0,25rem)] lg:gap-16">
            <div className="lg:pt-6">
              <p className="eyebrow">A high-signal network for builders</p>
              <h1 className="mt-4 text-[2.5rem] font-semibold leading-[1.05] sm:text-5xl xl:text-[3.5rem]">
                Ship your thoughts
                <br />
                like you ship code.
              </h1>
              <p className="mt-5 max-w-md text-[17px] leading-relaxed text-secondary">
                A network for Web3 builders, founders and investors. One global timeline — no
                follower games, no algorithm, just signal.
              </p>

              <div className="mt-7 flex flex-wrap gap-2">
                {[
                  "Verified identity",
                  "Signal & Beat feeds",
                  "Silver & Gold badges",
                  "PulseAssist AI",
                  "Shareable status cards",
                ].map((label) => (
                  <span key={label} className="chip">
                    {label}
                  </span>
                ))}
              </div>

              <div
                className="mt-8 flex items-center gap-2.5 border-t pt-6 text-sm text-tertiary"
                style={{ borderColor: "var(--border)" }}
              >
                <ShieldCheck className="h-4 w-4 shrink-0" />
                Real names, real projects. Every badge is reviewed by a human.
              </div>
            </div>

            {/* Auth card — the primary action, so it keeps its own column. */}
            <div className="w-full">
              <div className="card p-6" style={{ boxShadow: "var(--shadow-lg)" }}>
                {view === "social" && (
                  <div className="mb-5">
                    <h2 className="text-base font-semibold">Join The Ledger</h2>
                    <p className="mt-1 text-[13px] leading-relaxed text-secondary">
                      Claim your handle and start shipping.
                    </p>
                  </div>
                )}
                {authCardContent}
              </div>
            </div>
          </div>
        </section>

        {/* ── Product preview ── */}
        <section
          className="border-y"
          style={{ borderColor: "var(--border)", background: "rgba(255,255,255,0.012)" }}
        >
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
              <div>
                <p className="eyebrow">Studio</p>
                <h2 className="mt-3 text-[1.75rem] font-semibold leading-tight sm:text-[2rem]">
                  Every post is a card worth sharing.
                </h2>
                <p className="mt-4 max-w-md text-[15px] leading-relaxed text-secondary">
                  Write it once, then export a 1080×1920 card straight to your photos — ready for
                  WhatsApp Status, Stories or anywhere else you post.
                </p>
                <ul className="mt-6 space-y-3">
                  {[
                    "Seven card themes, no design work",
                    "Your badge and handle baked in",
                    "Saves to your gallery in one tap",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-secondary">
                      <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--gold)" }} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Framed, so the preview reads as a product shot rather than a stray element. */}
              <div className="mx-auto w-full max-w-[19rem]">
                <div
                  className="rounded-[1.75rem] border p-3"
                  style={{
                    borderColor: "var(--border)",
                    background: "var(--surface-1)",
                    boxShadow: "var(--shadow-lg)",
                  }}
                >
                  <StatusCard
                    name="Aria Stone"
                    handle="ariastone"
                    content={`Building quiet infra with loud ambition.\n\nNotes from the workshop, shipped daily.`}
                    verificationTier="gold"
                  />
                </div>
                <p className="mt-3 text-center text-xs text-tertiary">
                  Exported at 1080×1920, ready to post
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Features ── */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto mb-10 max-w-lg text-center">
            <p className="eyebrow">Everything on the platform</p>
            <h2 className="mt-3 text-[1.75rem] font-semibold leading-tight sm:text-[2rem]">
              Built for people who ship
            </h2>
          </div>

          {/*
            An even three-column grid. The first card used to span two columns,
            which left the six cards in a 2 / 3 / 1 arrangement with an orphan on
            its own row.
          */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {BENTO_CARDS.map((card) => (
              <div key={card.headline} className="card card-interactive flex flex-col p-5">
                <div
                  className="mb-4 grid h-9 w-9 place-items-center rounded-xl border"
                  style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
                >
                  <card.icon className="h-4 w-4 text-secondary" />
                </div>
                <h3 className="text-[15px] font-semibold">{card.headline}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-secondary">{card.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Closing call to action ── */}
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
          <div className="card px-6 py-12 text-center sm:px-12 sm:py-16">
            <h2 className="text-[1.75rem] font-semibold leading-tight sm:text-[2rem]">
              Start shipping in public.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-secondary">
              Claim your handle, publish your first update, and let your work speak.
            </p>
            <div className="mt-7 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  setView("email-signup");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="btn btn-primary btn-lg w-full sm:w-auto"
              >
                Create your account
              </button>
              <Link to="/feed" className="btn btn-outline btn-lg w-full sm:w-auto">
                Browse the feed first
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer — the page previously just ended ── */}
      <footer className="border-t" style={{ borderColor: "var(--border)" }}>
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2.5">
            <LedgerMark className="h-4 w-auto" />
            <span className="text-[13px] font-semibold tracking-tight">The Ledger</span>
            <span className="text-[13px] text-tertiary">· For founders who ship.</span>
          </div>
          <div className="flex items-center gap-5 text-[13px] text-tertiary">
            <Link to="/feed" className="transition-colors hover:text-foreground">
              Feed
            </Link>
            {TERMS_URL ? (
              <a
                href={TERMS_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="transition-colors hover:text-foreground"
              >
                Terms
              </a>
            ) : null}
          </div>
        </div>
      </footer>
    </div>
  );
}

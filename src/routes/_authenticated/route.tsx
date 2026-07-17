import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// sessionStorage key prefix for the onboarding cache — also exported so
// onboarding.tsx can bust it when the user completes onboarding.
export const OB_CACHE_PREFIX = "ob:";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // getSession() reads the JWT from localStorage — no network call.
    // getUser() validates the JWT with Supabase's auth server on every call,
    // adding 100-300 ms to every page navigation. For a client-only auth
    // guard getSession() is sufficient; the JWT itself already proves identity.
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) throw redirect({ to: "/" });
    const user = data.session.user;

    // Cache onboarding status in sessionStorage — only hit the DB once per
    // browser session instead of on every navigation to an authenticated route.
    // Invalidated in onboarding.tsx after the profile update completes.
    const cacheKey = `${OB_CACHE_PREFIX}${user.id}`;
    let onboardingCompleted: boolean | null = null;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached !== null) {
      onboardingCompleted = cached === "1";
    } else {
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("onboarding_completed")
          .eq("id", user.id)
          .maybeSingle();
        onboardingCompleted = profile?.onboarding_completed ?? null;
        if (onboardingCompleted !== null) {
          sessionStorage.setItem(cacheKey, onboardingCompleted ? "1" : "0");
        }
      } catch {
        // DB unreachable — fail open and let child route handle it
      }
    }

    const onOnboarding = location.pathname === "/onboarding";
    if (onboardingCompleted === false && !onOnboarding) throw redirect({ to: "/onboarding" });
    if (onboardingCompleted === true && onOnboarding) throw redirect({ to: "/feed" });

    return { user };
  },
  component: () => <Outlet />,
});

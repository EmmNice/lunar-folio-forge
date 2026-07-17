import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/" });

    // Fetch onboarding status — wrapped so a DB error doesn't crash the route
    let onboardingCompleted: boolean | null = null;
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", data.user.id)
        .maybeSingle();
      onboardingCompleted = profile?.onboarding_completed ?? null;
    } catch {
      // DB unreachable — fail open and let the child route handle it
    }

    const onOnboarding = location.pathname === "/onboarding";

    if (onboardingCompleted === false && !onOnboarding) {
      throw redirect({ to: "/onboarding" });
    }
    if (onboardingCompleted === true && onOnboarding) {
      throw redirect({ to: "/feed" });
    }

    return { user: data.user };
  },
  component: () => <Outlet />,
});

import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type RoleType = "founder" | "developer" | "pm" | "investor";
export type VerificationTier = "none" | "silver" | "gold";

export type Profile = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  date_of_birth: string | null;
  role_type: RoleType | null;
  company_name: string | null;
  onboarding_completed: boolean;
  verification_tier: VerificationTier;
  github_url: string | null;
  portfolio_url: string | null;
  startup_url: string | null;
  traction_url: string | null;
};

const PROFILE_COLUMNS =
  "id, handle, display_name, avatar_url, bio, date_of_birth, role_type, company_name, onboarding_completed, verification_tier, github_url, portfolio_url, startup_url, traction_url";

export type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
};

async function loadProfile(user: User | null): Promise<Profile | null> {
  if (!user) return null;
  // Small retry loop — the auth trigger creates the profile row asynchronously
  // on first sign-in, so the very first fetch can race and see nothing.
  for (let i = 0; i < 4; i++) {
    const { data } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", user.id)
      .maybeSingle();
    if (data) return data as Profile;
    await new Promise((r) => setTimeout(r, 250 * (i + 1)));
  }
  return null;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<Omit<AuthState, "refreshProfile">>({
    loading: true,
    session: null,
    user: null,
    profile: null,
  });

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      const user = data.session?.user ?? null;
      const profile = await loadProfile(user);
      if (cancelled) return;
      setState({ loading: false, session: data.session, user, profile });
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      const user = session?.user ?? null;
      const profile = await loadProfile(user);
      if (cancelled) return;
      setState({ loading: false, session, user, profile });
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function refreshProfile() {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user ?? null;
    const profile = await loadProfile(user);
    setState((s) => ({ ...s, user, session: data.session, profile }));
  }

  return { ...state, refreshProfile };
}

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
  subscription_status: string | null;
  ai_credits_used: number;
  ai_credits_reset_at: string | null;
  pitch_limit: number | null;
  dm_cloaking_enabled: boolean;
};

// NOTE: subscription_status, ai_credits_*, pitch_limit are added by migration 002.
// They are fetched separately so the app keeps working before that migration runs.
const PROFILE_COLUMNS =
  "id, handle, display_name, avatar_url, bio, date_of_birth, role_type, company_name, onboarding_completed, verification_tier, github_url, portfolio_url, startup_url, traction_url";

export type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  refreshProfile: () => Promise<void>;
};

async function loadProfile(user: User | null): Promise<{ profile: Profile | null; isAdmin: boolean }> {
  if (!user) return { profile: null, isAdmin: false };

  // Small retry loop — the auth trigger creates the profile row asynchronously
  // on first sign-in, so the very first fetch can race and see nothing.
  // Fire all three reads in parallel — base profile, migration-002 extras, admin role.
  // The retry loop is kept only for the base profile (auth trigger races on first sign-in).
  let profile: Profile | null = null;

  // Check admin role — wrapped in async IIFE so .catch works on the awaited promise
  const isAdmin = await (async () => {
    try {
      const { data } = await supabase.rpc("has_role", { _role: "admin", _user_id: user.id });
      return data === true;
    } catch {
      return false;
    }
  })();

  for (let i = 0; i < 4; i++) {
    // Run base + extras in parallel each attempt
    const [baseRes, extraRes] = await Promise.all([
      supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).maybeSingle(),
      supabase
        .from("profiles")
        .select("subscription_status, ai_credits_used, ai_credits_reset_at, pitch_limit, dm_cloaking_enabled")
        .eq("id", user.id)
        .maybeSingle(),
    ]);

    if (baseRes.data) {
      const extra = extraRes.data as { subscription_status?: string; ai_credits_used?: number; ai_credits_reset_at?: string | null; pitch_limit?: number | null; dm_cloaking_enabled?: boolean } | null;
      profile = {
        ...baseRes.data,
        subscription_status: extra?.subscription_status ?? "active",
        ai_credits_used: extra?.ai_credits_used ?? 0,
        ai_credits_reset_at: extra?.ai_credits_reset_at ?? null,
        pitch_limit: extra?.pitch_limit ?? null,
        dm_cloaking_enabled: extra?.dm_cloaking_enabled ?? false,
      } as Profile;
      break;
    }
    await new Promise((r) => setTimeout(r, 250 * (i + 1)));
  }

  return { profile, isAdmin };
}

export function useAuth(): AuthState {
  const [state, setState] = useState<Omit<AuthState, "refreshProfile">>({
    loading: true,
    session: null,
    user: null,
    profile: null,
    isAdmin: false,
  });

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      const user = data.session?.user ?? null;
      const { profile, isAdmin } = await loadProfile(user);
      if (cancelled) return;
      setState({ loading: false, session: data.session, user, profile, isAdmin });
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      const user = session?.user ?? null;
      const { profile, isAdmin } = await loadProfile(user);
      if (cancelled) return;
      setState({ loading: false, session, user, profile, isAdmin });
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function refreshProfile() {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user ?? null;
    const { profile, isAdmin } = await loadProfile(user);
    setState((s) => ({ ...s, user, session: data.session, profile, isAdmin }));
  }

  return { ...state, refreshProfile };
}

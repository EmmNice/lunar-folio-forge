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

// Base columns that always exist (no migration dependency)
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

/**
 * Loads the full profile for a user. Always resolves — never throws.
 * Returns null profile if the user has no row yet (new account race) or DB is down.
 */
async function loadProfile(user: User | null): Promise<{ profile: Profile | null; isAdmin: boolean }> {
  if (!user) return { profile: null, isAdmin: false };

  // Admin check — isolated try/catch so it never blocks the rest
  let isAdmin = false;
  try {
    const { data } = await supabase.rpc("has_role", { _role: "admin", _user_id: user.id });
    isAdmin = data === true;
  } catch {
    // RPC missing or network error — treat as non-admin
  }

  // Profile fetch with retry loop for new-account auth trigger race.
  // 3 attempts: 0ms, 300ms, 700ms backoff. Always completes without throwing.
  let profile: Profile | null = null;
  const delays = [0, 300, 700];

  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise((r) => setTimeout(r, delays[i]));

    try {
      const [baseRes, extraRes] = await Promise.all([
        supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).maybeSingle(),
        supabase
          .from("profiles")
          .select("subscription_status, ai_credits_used, ai_credits_reset_at, pitch_limit, dm_cloaking_enabled")
          .eq("id", user.id)
          .maybeSingle(),
      ]);

      if (baseRes.data) {
        const extra = extraRes.data as {
          subscription_status?: string;
          ai_credits_used?: number;
          ai_credits_reset_at?: string | null;
          pitch_limit?: number | null;
          dm_cloaking_enabled?: boolean;
        } | null;

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
    } catch {
      // DB error on this attempt — will retry or give up gracefully
    }
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

    // Initial session load — always resolves, never freezes
    async function init() {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        const user = data.session?.user ?? null;
        const { profile, isAdmin } = await loadProfile(user);
        if (cancelled) return;
        setState({ loading: false, session: data.session, user, profile, isAdmin });
      } catch {
        // Absolute worst case (getSession itself throws) — unfreeze loading
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      }
    }
    init();

    // Listen for auth changes; errors are swallowed so they never freeze the UI
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      try {
        const user = session?.user ?? null;
        const { profile, isAdmin } = await loadProfile(user);
        if (cancelled) return;
        setState({ loading: false, session, user, profile, isAdmin });
      } catch {
        // Don't freeze on auth-event errors
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function refreshProfile() {
    try {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user ?? null;
      const { profile, isAdmin } = await loadProfile(user);
      setState((s) => ({ ...s, user, session: data.session, profile, isAdmin }));
    } catch {
      // Silently ignore refresh errors
    }
  }

  return { ...state, refreshProfile };
}

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
  hide_from_search: boolean;
};

// Profile columns split into tiers so a missing column from an unapplied
// migration never blocks the whole profile load.
//
// Tier 1 — initial schema (always present):
const BASE_PROFILE_COLUMNS = "id, handle, display_name, avatar_url, bio";
// Tier 2 — ledger_v2_social_and_verification migration:
const V2_PROFILE_COLUMNS =
  BASE_PROFILE_COLUMNS +
  ", date_of_birth, role_type, company_name, onboarding_completed, verification_tier";
// Tier 3 — later optional migrations (002_overhaul, 003_privacy, v2_dual_track):
const ALL_PROFILE_COLUMNS =
  V2_PROFILE_COLUMNS +
  ", github_url, portfolio_url, startup_url, traction_url" +
  ", subscription_status, ai_credits_used, ai_credits_reset_at, pitch_limit, dm_cloaking_enabled";

// Defaults used when optional columns are absent from the DB.
const OPTIONAL_COLUMN_DEFAULTS = {
  date_of_birth: null,
  role_type: null,
  company_name: null,
  onboarding_completed: false,
  verification_tier: "none" as const,
  github_url: null,
  portfolio_url: null,
  startup_url: null,
  traction_url: null,
  subscription_status: "active",
  ai_credits_used: 0,
  ai_credits_reset_at: null,
  pitch_limit: null,
  dm_cloaking_enabled: false,
  hide_from_search: false,
};

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
 * Returns null profile if the user has no row yet (new-account race) or DB is down.
 *
 * Parallelises the admin-role DB check with the profile fetch so neither
 * blocks the other. The env-var fast path skips the DB entirely.
 */
async function loadProfile(user: User | null): Promise<{ profile: Profile | null; isAdmin: boolean }> {
  if (!user) return { profile: null, isAdmin: false };

  // ── Admin check ────────────────────────────────────────────────────────────
  // Fast path: env var list — no DB round-trip at all.
  const envAdmins = (import.meta.env.VITE_ADMIN_IDS ?? "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);

  const adminPromise: Promise<boolean> = envAdmins.includes(user.id)
    ? Promise.resolve(true)
    : supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .limit(10)
        .then(({ data, error }) => {
          if (error) {
            console.error("[auth] user_roles query failed:", error.message, error.code);
            return false;
          }
          const admin = Array.isArray(data) && data.some((r: any) => r.role === "admin");
          if (!admin) console.warn("[auth] user_roles rows:", JSON.stringify(data));
          return admin;
        })
        .catch((e) => {
          console.error("[auth] admin check threw:", e);
          return false;
        });

  // ── Profile fetch ──────────────────────────────────────────────────────────
  // Tiered fallback: try all columns first, then v2 columns, then base.
  // This means a missing column from an unapplied migration never prevents
  // the profile from loading — we just fill in defaults for absent columns.
  // The retry loop handles the new-account race where the DB trigger hasn't
  // fired yet (profile row not yet created).
  const profilePromise: Promise<Profile | null> = (async () => {
    // Try to fetch the profile row, falling back to progressively fewer
    // columns if a "column does not exist" error is returned.
    async function fetchProfileRow(userId: string): Promise<Record<string, unknown> | null> {
      for (const cols of [ALL_PROFILE_COLUMNS, V2_PROFILE_COLUMNS, BASE_PROFILE_COLUMNS]) {
        const { data, error } = await supabase
          .from("profiles")
          .select(cols)
          .eq("id", userId)
          .maybeSingle();
        if (!error) return data as Record<string, unknown> | null;
        console.error(`[auth] profile fetch error (cols="${cols.slice(0, 40)}…"):`, error.message);
        // Only retry with fewer columns on a "column does not exist" class error.
        // Other errors (network, RLS) should just break out so the retry loop retries later.
        if (!error.message.includes("column") && error.code !== "42703") break;
      }
      return null;
    }

    const delays = [0, 300, 700];
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) await new Promise((r) => setTimeout(r, delays[i]));
      try {
        const data = await fetchProfileRow(user.id);
        if (data) {
          // Try to read hide_from_search separately — it was added in its own
          // migration and may not be in any of the column tiers above.
          let hide_from_search = false;
          try {
            const { data: extra } = await supabase
              .from("profiles")
              .select("hide_from_search")
              .eq("id", user.id)
              .maybeSingle();
            hide_from_search = (extra as any)?.hide_from_search ?? false;
          } catch { /* column doesn't exist yet — use default */ }

          return {
            ...OPTIONAL_COLUMN_DEFAULTS,
            ...data,
            hide_from_search,
          } as Profile;
        }
      } catch {
        // DB error on this attempt — will retry or give up gracefully
      }
    }
    return null;
  })();

  // ── Both in parallel ───────────────────────────────────────────────────────
  const [isAdmin, profile] = await Promise.all([adminPromise, profilePromise]);
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

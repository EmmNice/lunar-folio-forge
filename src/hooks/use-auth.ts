import { useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { parseNotificationPrefs, type NotificationPrefs } from "@/lib/notification-prefs";
import { resetPerUserState } from "@/lib/session-reset";

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
  /**
   * When the username was last changed after onboarding; null means never.
   *
   * Deliberately not granted to `authenticated` at the column level — when someone
   * last renamed is nobody else's business. It reaches the owner only because
   * current_profile() is SECURITY DEFINER and returns the whole row.
   */
  handle_changed_at: string | null;
  notification_prefs: NotificationPrefs;
  /** 'active' | 'restricted' | 'banned' — moderation state, set by admins only. */
  account_status: AccountStatus;
};

export type AccountStatus = "active" | "restricted" | "banned";

/**
 * A brand-new account can reach the app before the on_auth_user_created trigger
 * has committed its profile row, so the first read comes back empty. Retry a
 * couple of times before giving up.
 */
const PROFILE_RETRY_DELAYS_MS = [0, 300, 700];

function logAuthIssue(message: string, detail?: unknown) {
  if (import.meta.env.DEV) console.error(`[auth] ${message}`, detail ?? "");
}

/**
 * Loads the signed-in member's own profile.
 *
 * Goes through the current_profile() RPC rather than selecting from `profiles`,
 * because date_of_birth, subscription_status, the AI credit counters,
 * notification_prefs and account_status are no longer granted to `authenticated`
 * (20260929000100 — they used to be readable for *every* member by anyone with
 * the publishable key). The RPC is SECURITY DEFINER and scoped to auth.uid(), so
 * it returns exactly one row: yours.
 */
async function fetchProfile(userId: string): Promise<Profile | null> {
  for (const delay of PROFILE_RETRY_DELAYS_MS) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

    const { data, error } = await supabase.rpc("current_profile").maybeSingle();

    if (error) {
      logAuthIssue("profile fetch failed:", error.message);
      continue;
    }
    if (data) {
      const row = data as unknown as Omit<Profile, "notification_prefs" | "account_status"> & {
        notification_prefs: unknown;
        account_status: string | null;
      };

      /*
        The identity check that makes this safe.

        current_profile() resolves through auth.uid() — it returns whoever the
        *current access token* belongs to, and takes no argument. This parameter
        used to be named `_userId` and was genuinely unused, which meant
        loadProfile(userA) could return user B's profile whenever the token had
        rotated while the read was in flight: sign out of A and into B quickly
        enough and the resolved profile was B's, but it was stored in state
        alongside `user: A`.

        That is the cross-account leak. `user` and `profile` could disagree, and
        every screen trusts `profile` for identity — the header avatar and handle,
        the composer's author, the self-view of a profile page. So account A's
        session could render account B's name, handle and private fields.

        Discarding a mismatch is the correct response rather than trusting the
        row: whichever token won, this caller asked about a different user, and
        the caller for the *other* user is already in flight behind it.
      */
      if (row.id !== userId) {
        logAuthIssue("discarded a profile belonging to a different user than requested");
        return null;
      }

      return {
        ...row,
        notification_prefs: parseNotificationPrefs(row.notification_prefs),
        account_status: (row.account_status ?? "active") as AccountStatus,
      };
    }
  }
  return null;
}

async function fetchIsAdmin(userId: string): Promise<boolean> {
  // Matches the server-side is_admin(), which accepts super_admin as well.
  // Checking only for 'admin' here meant a super_admin was bounced out of the
  // panel by the route guard while every server function happily accepted them.
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "super_admin"])
    .limit(1);

  if (error) {
    logAuthIssue("admin check failed:", error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Resolves the profile and admin flag for a user. Never throws — a failure here
 * must not leave the app stuck on a loading screen.
 */
async function loadProfile(
  user: User | null,
): Promise<{ profile: Profile | null; isAdmin: boolean }> {
  if (!user) return { profile: null, isAdmin: false };

  const [profile, isAdmin] = await Promise.all([
    fetchProfile(user.id).catch((error) => {
      logAuthIssue("profile load threw:", error);
      return null;
    }),
    fetchIsAdmin(user.id).catch((error) => {
      logAuthIssue("admin check threw:", error);
      return false;
    }),
  ]);

  return { profile, isAdmin };
}

export type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  refreshProfile: () => Promise<void>;
};

export function useAuth(): AuthState {
  const [state, setState] = useState<Omit<AuthState, "refreshProfile">>({
    loading: true,
    session: null,
    user: null,
    profile: null,
    isAdmin: false,
  });

  /**
   * Monotonic counter for auth resolutions.
   *
   * Every path here is async, so two of them can be in flight at once — an
   * initial session load and a SIGNED_IN, or a sign-out immediately followed by a
   * sign-in. Without a sequence number the slower one wins simply by finishing
   * last, which is how a previous account's state could be written over a newer
   * one. Only the most recently *started* resolution is allowed to commit.
   */
  const resolutionSeq = useRef(0);
  /** Last committed user id, to detect an account switch rather than a refresh. */
  const committedUserId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolve(session: Session | null, reason: string) {
      const seq = (resolutionSeq.current += 1);
      const user = session?.user ?? null;

      // Switching accounts (or leaving one) must not inherit the previous
      // account's cached client state. Done before the profile read so the new
      // session never observes the old account's unread count.
      if (committedUserId.current !== null && committedUserId.current !== (user?.id ?? null)) {
        resetPerUserState();
      }

      try {
        const { profile, isAdmin } = await loadProfile(user);
        // A newer resolution started while this one was reading: discard.
        if (cancelled || seq !== resolutionSeq.current) return;

        committedUserId.current = user?.id ?? null;
        setState({ loading: false, session, user, profile, isAdmin });
      } catch (error) {
        logAuthIssue(`${reason} failed:`, error);
        if (!cancelled && seq === resolutionSeq.current) {
          setState((s) => ({ ...s, loading: false }));
        }
      }
    }

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        await resolve(data.session, "session load");
      } catch (error) {
        logAuthIssue("session load failed:", error);
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      void resolve(session, event);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function refreshProfile() {
    // Shares the sequence counter with the effect above: a refresh triggered by a
    // profile edit must not land after a sign-out and resurrect the old account.
    const seq = (resolutionSeq.current += 1);
    try {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user ?? null;
      const { profile, isAdmin } = await loadProfile(user);
      if (seq !== resolutionSeq.current) return;
      committedUserId.current = user?.id ?? null;
      setState((s) => ({ ...s, user, session: data.session, profile, isAdmin }));
    } catch (error) {
      logAuthIssue("profile refresh failed:", error);
    }
  }

  return { ...state, refreshProfile };
}

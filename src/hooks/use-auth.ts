import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Profile = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
};

export type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
};

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    loading: true,
    session: null,
    user: null,
    profile: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadProfile(user: User | null): Promise<Profile | null> {
      if (!user) return null;
      // Small retry loop — the auth trigger creates the profile row asynchronously
      // on first sign-in, so the very first fetch can race and see nothing.
      for (let i = 0; i < 4; i++) {
        const { data } = await supabase
          .from("profiles")
          .select("id, handle, display_name, avatar_url, bio")
          .eq("id", user.id)
          .maybeSingle();
        if (data) return data as Profile;
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
      }
      return null;
    }

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

  return state;
}

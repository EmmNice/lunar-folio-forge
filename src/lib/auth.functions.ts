import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { slugifyUsername } from "./username";

/**
 * Signing in with a username instead of an email address.
 *
 * Supabase authenticates against an email, and a username is the identifier people
 * actually remember here — it is on their profile, in their URL, and what other
 * members call them. So this resolves one to the other.
 *
 * The resolution happens on the server, and the sign-in happens on the server, for
 * one specific reason: the obvious client-side shape — "look up the email for this
 * username, then sign in with it" — turns the app into an oracle that converts any
 * username into that person's private email address. Nobody has to guess a password
 * to abuse that. So the email never leaves this function; what comes back is either
 * a session or a refusal.
 *
 * The refusal is deliberately identical whether the username does not exist, the
 * email does not exist, or the password is wrong. A login form that distinguishes
 * those is a tool for working out who has an account.
 */

/** What the browser needs to install the session it was just granted. */
export type SignInResult =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; reason: "invalid" | "unconfirmed" | "unavailable"; email?: string };

const GENERIC_FAILURE: SignInResult = { ok: false, reason: "invalid" };

export const signInWithIdentifier = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        /*
          One field for both. Trimmed but not lowercased here — an email address is
          case-insensitive in the local part in practice, and a username gets
          slugified below, so folding the whole string early would only make the
          branch harder to read.
        */
        identifier: z.string().min(1).max(320),
        password: z.string().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<SignInResult> => {
    const identifier = data.identifier.trim();
    const looksLikeEmail = identifier.includes("@");

    let email: string | null = null;

    if (looksLikeEmail) {
      email = identifier.toLowerCase();
    } else {
      /*
        A handle, so resolve it. slugifyUsername applies the same folding the rest of
        the system uses, which is what makes `Godson`, `GODSON` and `godson` all
        reach the same account rather than only the exact stored casing.
      */
      const handle = slugifyUsername(identifier);
      if (!handle) return GENERIC_FAILURE;

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("handle", handle)
        .maybeSingle();

      // No such handle. Same answer as a wrong password, on purpose.
      if (!profile) return GENERIC_FAILURE;

      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(profile.id);
      email = userData?.user?.email ?? null;
      /*
        A profile with no email is an OAuth-only account, and it gets the same
        generic failure as everything else.

        The tempting alternative — "that account signs in another way" — is a
        disclosure: it confirms the username exists, which is exactly what the
        uniform failure above exists to prevent. Someone in this position is not
        left stranded, because the failure message on the form mentions the social
        buttons to everybody who sees it, so it guides without confirming anything.
      */
      if (!email) return GENERIC_FAILURE;
    }

    if (!email) return GENERIC_FAILURE;

    /*
      The sign-in itself runs here rather than in the browser, so the resolved email
      is never disclosed. A short-lived client is used instead of the admin one:
      signInWithPassword must go through the public (anon) key to be subject to
      Supabase's own auth rate limiting, which is what stops this endpoint being a
      free password-guessing oracle.
    */
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !anonKey) {
      console.error("[auth] SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY missing");
      return { ok: false, reason: "unavailable" };
    }

    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: session, error } = await client.auth.signInWithPassword({
      email,
      password: data.password,
    });

    if (error) {
      const message = error.message.toLowerCase();
      // An unconfirmed address is the one failure worth distinguishing: the password
      // was right, and the person needs to be told to check their inbox rather than
      // left retyping a password that works.
      if (message.includes("not confirmed")) return { ok: false, reason: "unconfirmed", email };
      return GENERIC_FAILURE;
    }

    if (!session.session) return GENERIC_FAILURE;

    return {
      ok: true,
      accessToken: session.session.access_token,
      refreshToken: session.session.refresh_token,
    };
  });

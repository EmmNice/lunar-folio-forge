/**
 * Username rules, shared by signup, onboarding and the settings rename screen.
 *
 * These mirror the database exactly and are not the enforcement point. The real
 * rules are `username_is_valid()`, `username_is_reserved()`, the
 * `handle_format` CHECK and the UNIQUE index on `profiles.handle`
 * (20260930000100). Everything here exists so a person gets a sentence instead of
 * a constraint violation — and so the form can tell them a name is taken before
 * they submit rather than after.
 */

import { supabase } from "@/integrations/supabase/client";

export const USERNAME_MIN = 2;
export const USERNAME_MAX = 20;

/**
 * Coerces typing into a storable handle.
 *
 * Lowercasing here is what makes the whole system case-insensitive from the user's
 * point of view: typing `Godson` stores `godson`, so `Godson`, `GODSON` and
 * `godson` cannot become three accounts. The database agrees — its CHECK only
 * permits lowercase, so anything else would be rejected rather than duplicated.
 */
export function slugifyUsername(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, USERNAME_MAX);
}

export const USERNAME_HINT = `${USERNAME_MIN}–${USERNAME_MAX} characters — lowercase letters, numbers and underscores.`;

export type UsernameState =
  | { status: "empty" }
  | { status: "too-short" }
  | { status: "checking" }
  | { status: "available" }
  | { status: "unavailable"; reason: string; message: string }
  | { status: "error" };

type AvailabilityResult = {
  available: boolean;
  reason: string;
  message: string;
};

/**
 * Asks the database whether a username can be taken.
 *
 * Goes through the `username_available` RPC rather than selecting from `profiles`,
 * for three reasons: it works for `anon` (the person has not signed up yet), it
 * returns a verdict rather than rows, and it applies the reserved-name list —
 * which a `select ... where handle = ?` check would miss entirely, so `admin`
 * would look free right up until the insert failed.
 */
export async function checkUsername(candidate: string): Promise<UsernameState> {
  const slug = slugifyUsername(candidate);
  if (slug.length === 0) return { status: "empty" };
  if (slug.length < USERNAME_MIN) return { status: "too-short" };

  const { data, error } = await supabase.rpc("username_available", { _username: slug });
  if (error) return { status: "error" };

  const result = data as unknown as AvailabilityResult | null;
  if (!result) return { status: "error" };
  if (result.available) return { status: "available" };
  return { status: "unavailable", reason: result.reason, message: result.message };
}

/**
 * Turns a signup/rename failure into something worth reading.
 *
 * The database raises on a username that was taken between the availability check
 * and the insert. Supabase Auth wraps a trigger exception into a generic
 * "Database error saving new user", so the specific text has to be recognised here
 * or the member is told nothing useful about a problem they can actually fix.
 */
export function describeUsernameError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("already taken") || m.includes("profiles_handle_key") || m.includes("duplicate")) {
    return "That username was just taken. Try another.";
  }
  if (m.includes("reserved")) {
    return "That username is reserved. Try another.";
  }
  if (m.includes("2-20 characters") || m.includes("handle_format")) {
    return USERNAME_HINT;
  }
  if (m.includes("once every 30 days")) {
    return "You can only change your username once every 30 days.";
  }
  // A trigger exception surfaces through Auth as this, with the cause swallowed.
  if (m.includes("database error saving new user")) {
    return "That username isn't available. Try another.";
  }
  return message;
}

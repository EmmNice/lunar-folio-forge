import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { VerificationBadge } from "@/components/VerificationBadge";
import { EmptyState } from "@/components/states";
import type { VerificationTier } from "@/hooks/use-auth";

/**
 * Who follows a profile, or who it follows.
 *
 * The follow graph existed with nothing to browse: counts were shown but not
 * openable, so there was no way to see who anybody was connected to — which is most
 * of what a social graph is for, and the main way people find the next person to
 * follow.
 *
 * `follows` is publicly readable by policy (it is a public relationship), and the
 * joined profile columns are the same public ones a profile card already shows.
 * Nothing private is reachable from here.
 */

type Row = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  verification_tier: VerificationTier;
  bio: string | null;
  skills: string[] | null;
};

const PAGE = 50;

export function FollowList({
  profileId,
  mode,
}: {
  profileId: string;
  mode: "followers" | "following";
}) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    (async () => {
      /*
        Which side of the row to read, and which side to join.

        followers -> rows where following_id is this profile, showing follower_id.
        following -> the mirror image. Both directions are covered by the
        follows_follower_idx / follows_following_idx indexes.
      */
      const select =
        mode === "followers"
          ? "profile:profiles!follows_follower_id_fkey(id, handle, display_name, avatar_url, verification_tier, bio, skills)"
          : "profile:profiles!follows_following_id_fkey(id, handle, display_name, avatar_url, verification_tier, bio, skills)";
      const column = mode === "followers" ? "following_id" : "follower_id";

      const { data } = await supabase
        .from("follows")
        .select(`created_at, ${select}`)
        .eq(column, profileId)
        .order("created_at", { ascending: false })
        .limit(PAGE);

      if (cancelled) return;
      const shaped = ((data ?? []) as unknown as { profile: Row | null }[])
        // A blocked member's profile comes back null through the join, so the row
        // is dropped rather than rendered as a blank entry.
        .map((r) => r.profile)
        .filter((p): p is Row => p !== null);
      setRows(shaped);
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, mode]);

  if (rows === null) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card flex items-center gap-3 p-4">
            <span className="skeleton h-10 w-10 shrink-0 rounded-full" />
            <span className="flex-1 space-y-2">
              <span className="skeleton block h-3.5 w-36 rounded-full" />
              <span className="skeleton block h-3 w-24 rounded-full" />
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={mode === "followers" ? "No followers yet" : "Not following anyone yet"}
        description={
          mode === "followers"
            ? "When someone follows this profile, they'll appear here."
            : "Profiles they follow will appear here."
        }
      />
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((p) => (
        <li key={p.id}>
          <Link
            to="/u/$handle"
            params={{ handle: p.handle }}
            search={{ tab: undefined }}
            className="card card-interactive flex items-start gap-3 p-4"
          >
            <span className="grid h-10 w-10 shrink-0 overflow-hidden rounded-full bg-secondary/60 text-sm font-semibold">
              {p.avatar_url ? (
                <img
                  src={p.avatar_url}
                  alt=""
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="grid h-full w-full place-items-center text-foreground/70">
                  {p.display_name.charAt(0).toUpperCase()}
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-semibold leading-tight text-foreground">
                {p.display_name}
                <VerificationBadge tier={p.verification_tier} size={13} />
              </span>
              <span className="mt-0.5 block text-[12px] text-tertiary">@{p.handle}</span>
              {p.bio ? (
                <span className="mt-1 line-clamp-1 block text-[12px] text-secondary">{p.bio}</span>
              ) : null}
              {p.skills && p.skills.length > 0 ? (
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {p.skills.slice(0, 4).map((s) => (
                    <span
                      key={s}
                      className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                      style={{
                        background: "rgba(255,255,255,0.06)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {s}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

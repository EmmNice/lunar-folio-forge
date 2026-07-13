import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MessageSquare, UserPlus, UserMinus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { StatusCard, type Background } from "@/components/StatusCard";
import { useAuth } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { startConversation } from "@/lib/messaging.functions";
import { timeAgo } from "@/lib/time";

export const Route = createFileRoute("/u/$handle")({
  head: ({ params }) => ({
    meta: [
      { title: `@${params.handle} · Godson` },
      { name: "description", content: `Public profile and status cards from @${params.handle}.` },
      { property: "og:title", content: `@${params.handle} on Godson` },
    ],
  }),
  component: ProfilePage,
});

type ProfileRow = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
};

type PostRow = {
  id: string;
  content: string;
  background: Background;
  created_at: string;
};

function ProfilePage() {
  const { handle } = Route.useParams();
  const { user, profile: me } = useAuth();
  const navigate = useNavigate();
  const start = useServerFn(startConversation);

  const [profile, setProfile] = useState<ProfileRow | null | undefined>(undefined);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [followState, setFollowState] = useState<{ following: boolean; followers: number }>({
    following: false,
    followers: 0,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: pf, error } = await supabase
        .from("profiles")
        .select("id, handle, display_name, avatar_url, bio")
        .eq("handle", handle)
        .maybeSingle();
      if (cancelled) return;
      if (error || !pf) {
        setProfile(null);
        return;
      }
      setProfile(pf);

      const [{ data: postsData }, { count: followersCount }, myFollow] = await Promise.all([
        supabase
          .from("posts")
          .select("id, content, background, created_at")
          .eq("author_id", pf.id)
          .order("created_at", { ascending: false })
          .limit(30),
        supabase.from("follows").select("*", { count: "exact", head: true }).eq("following_id", pf.id),
        user
          ? supabase
              .from("follows")
              .select("follower_id")
              .eq("follower_id", user.id)
              .eq("following_id", pf.id)
              .maybeSingle()
          : Promise.resolve({ data: null } as { data: null }),
      ]);
      if (cancelled) return;
      setPosts((postsData ?? []) as PostRow[]);
      setFollowState({
        following: !!(myFollow as { data: unknown }).data,
        followers: followersCount ?? 0,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [handle, user]);

  async function toggleFollow() {
    if (!user || !profile) {
      toast.error("Sign in to follow people.");
      return;
    }
    if (profile.id === user.id) return;
    setBusy(true);
    if (followState.following) {
      const { error } = await supabase
        .from("follows")
        .delete()
        .eq("follower_id", user.id)
        .eq("following_id", profile.id);
      if (error) toast.error("Couldn't unfollow.");
      else setFollowState((s) => ({ following: false, followers: s.followers - 1 }));
    } else {
      const { error } = await supabase
        .from("follows")
        .insert({ follower_id: user.id, following_id: profile.id });
      if (error) toast.error("Couldn't follow.");
      else setFollowState((s) => ({ following: true, followers: s.followers + 1 }));
    }
    setBusy(false);
  }

  async function message() {
    if (!user || !me || !profile) {
      toast.error("Sign in to send a message.");
      return;
    }
    try {
      const res = await start({ data: { recipientId: profile.id } });
      navigate({ to: "/messages/$id", params: { id: res.conversationId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start a conversation.");
    }
  }

  if (profile === undefined) {
    return (
      <div className="min-h-screen">
        <AppHeader />
        <div className="mx-auto max-w-5xl px-6 pt-16 text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (profile === null) {
    return (
      <div className="min-h-screen">
        <AppHeader />
        <div className="mx-auto max-w-5xl px-6 pt-16">
          <h1 className="text-xl font-semibold">Profile not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            No one on Godson uses the handle @{handle}.
          </p>
          <Link to="/feed" className="mt-6 inline-block text-sm underline underline-offset-4">
            Back to the feed
          </Link>
        </div>
      </div>
    );
  }

  const isSelf = user?.id === profile.id;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 pt-10 pb-24 sm:px-6">
        <header className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <div className="grid h-20 w-20 shrink-0 overflow-hidden rounded-full border border-border bg-secondary/50 text-2xl font-semibold">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="grid h-full w-full place-items-center">
                {profile.display_name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
              {profile.display_name}
            </h1>
            <p className="text-sm text-muted-foreground">
              @{profile.handle} · {followState.followers}{" "}
              {followState.followers === 1 ? "follower" : "followers"}
            </p>
            {profile.bio ? (
              <p className="mt-2 max-w-prose text-sm text-foreground/90">{profile.bio}</p>
            ) : null}
          </div>
          {!isSelf ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={toggleFollow}
                disabled={busy}
                className={
                  followState.following
                    ? "inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    : "inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
                }
              >
                {followState.following ? (
                  <>
                    <UserMinus className="h-4 w-4" /> Following
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4" /> Follow
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={message}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
              >
                <MessageSquare className="h-4 w-4" /> Message
              </button>
            </div>
          ) : (
            <Link
              to="/settings"
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Edit profile
            </Link>
          )}
        </header>

        <section className="mt-10">
          <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Cards
          </h2>
          {posts.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Nothing published yet.</p>
          ) : (
            <div className="mt-6 columns-1 gap-6 sm:columns-2 lg:columns-3 [column-fill:_balance]">
              {posts.map((p) => (
                <div key={p.id} className="mb-6 break-inside-avoid">
                  <div className="overflow-hidden rounded-2xl border border-border/60">
                    <StatusCard
                      name={profile.display_name}
                      handle={profile.handle}
                      avatarUrl={profile.avatar_url}
                      content={p.content}
                      background={p.background}
                    />
                  </div>
                  <div className="mt-2 px-1 text-xs text-muted-foreground">
                    {timeAgo(p.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

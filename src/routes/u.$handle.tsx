import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MessageSquare, Github, Rocket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { StatusCard, type Background } from "@/components/StatusCard";
import { VerificationBadge } from "@/components/VerificationBadge";
import { PitchModal, type PitchTarget } from "@/components/PitchModal";
import { useAuth } from "@/hooks/use-auth";
import type { RoleType, VerificationTier } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { startConversation } from "@/lib/messaging.functions";
import { timeAgo } from "@/lib/time";

export const Route = createFileRoute("/u/$handle")({
  head: ({ params }) => ({
    meta: [
      { title: `@${params.handle} · The Ledger` },
      { name: "description", content: `Public profile and status cards from @${params.handle}.` },
      { property: "og:title", content: `@${params.handle} on The Ledger` },
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
  company_name: string | null;
  role_type: RoleType | null;
  verification_tier: VerificationTier;
  github_url: string | null;
  portfolio_url: string | null;
  startup_url: string | null;
  traction_url: string | null;
  pitch_limit: number | null;
};

type PostRow = {
  id: string;
  content: string;
  background: Background;
  created_at: string;
};

const ROLE_LABEL: Record<RoleType, string> = {
  founder: "Startup Founder",
  developer: "Core Developer",
  pm: "Technical PM",
  investor: "VC / Investor",
};

function ProfilePage() {
  const { handle } = Route.useParams();
  const { user, profile: me } = useAuth();
  const navigate = useNavigate();
  const start = useServerFn(startConversation);

  const [profile, setProfile] = useState<ProfileRow | null | undefined>(undefined);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [busyMsg, setBusyMsg] = useState(false);
  const [showPitchModal, setShowPitchModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: pf, error } = await supabase
        .from("profiles")
        .select(
          "id, handle, display_name, avatar_url, bio, company_name, role_type, verification_tier, github_url, portfolio_url, startup_url, traction_url, pitch_limit",
        )
        .eq("handle", handle)
        .maybeSingle();
      if (cancelled) return;
      if (error || !pf) { setProfile(null); return; }
      setProfile(pf as unknown as ProfileRow);

      const { data: postsData } = await supabase
        .from("posts")
        .select("id, content, background, created_at")
        .eq("author_id", pf.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (cancelled) return;
      setPosts((postsData ?? []) as PostRow[]);
    })();
    return () => { cancelled = true; };
  }, [handle]);

  async function message() {
    if (!user || !me || !profile) { toast.error("Sign in to send a message."); return; }
    setBusyMsg(true);
    try {
      const res = await start({ data: { recipientId: profile.id } });
      navigate({ to: "/messages/$id", params: { id: res.conversationId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start a conversation.");
    } finally {
      setBusyMsg(false);
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
            No one on The Ledger uses the handle @{handle}.
          </p>
          <Link to="/feed" className="mt-6 inline-block text-sm underline underline-offset-4">
            Back to the feed
          </Link>
        </div>
      </div>
    );
  }

  const isSelf = user?.id === profile.id;
  const isVerified = profile.verification_tier !== "none";
  const isGold = profile.verification_tier === "gold";

  // Viewer's verification status
  const viewerIsSilverOrGold =
    me?.verification_tier === "silver" || me?.verification_tier === "gold";

  const connectLinks = [
    profile.github_url ? { label: "GitHub", href: profile.github_url, icon: Github } : null,
    profile.startup_url ? { label: "Startup", href: profile.startup_url, icon: Rocket } : null,
  ].filter(Boolean) as { label: string; href: string; icon: typeof Github }[];

  // Pitch target for the modal
  const pitchTarget: PitchTarget = {
    id: profile.id,
    handle: profile.handle,
    display_name: profile.display_name,
    avatar_url: profile.avatar_url,
    verification_tier: profile.verification_tier,
    company_name: profile.company_name,
    pitch_limit: (profile as any).pitch_limit ?? null,
  };

  return (
    <div className="min-h-screen pb-16 sm:pb-0">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 pt-10 pb-24 sm:px-6">
        <header className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          {/* Avatar */}
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
            <h1 className="flex items-center gap-2 truncate text-2xl font-semibold tracking-tight sm:text-3xl">
              {profile.display_name}
              <VerificationBadge tier={profile.verification_tier} size={20} />
            </h1>
            <p className="text-sm text-muted-foreground">
              @{profile.handle}
              {profile.role_type ? ` · ${ROLE_LABEL[profile.role_type]}` : ""}
              {profile.company_name ? ` · ${profile.company_name}` : ""}
            </p>
            {profile.bio ? (
              <p className="mt-2 max-w-prose text-sm text-foreground/90">{profile.bio}</p>
            ) : null}
          </div>

          {!isSelf ? (
            <div className="flex flex-wrap gap-2">
              {/* Connect links (GitHub, Startup) for verified profiles */}
              {isVerified &&
                connectLinks.map((l) => (
                  <a
                    key={l.label}
                    href={l.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
                  >
                    <l.icon className="h-4 w-4" /> {l.label}
                  </a>
                ))}

              {/* Structured Pitch button: Silver viewer → Gold profile */}
              {isGold && viewerIsSilverOrGold && user && me && (
                <button
                  type="button"
                  onClick={() => setShowPitchModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/20"
                >
                  <Rocket className="h-4 w-4" /> Pitch
                </button>
              )}

              {/* Message button */}
              {user && me && (
                <button
                  type="button"
                  onClick={message}
                  disabled={busyMsg}
                  className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  <MessageSquare className="h-4 w-4" /> Message
                </button>
              )}
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

        {/* ── Cards grid ── */}
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
                      verificationTier={profile.verification_tier}
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

      {/* Pitch modal */}
      {showPitchModal && user && me && (
        <PitchModal
          target={pitchTarget}
          senderId={user.id}
          onClose={() => setShowPitchModal(false)}
        />
      )}
    </div>
  );
}

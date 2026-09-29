import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  MessageSquare,
  Github,
  Rocket,
  ShieldCheck,
  Loader2,
  Pencil,
  X,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileCode2,
  Building2,
  Users,
  Heart,
  FileText,
  Plus,
  UserPlus,
  UserCheck,
  MoreHorizontal,
  Ban,
  VolumeX,
  Volume2,
  MapPin,
  Code2,
  FolderGit2,
  Bookmark,
  Copy,
  Check,
  RefreshCw,
} from "lucide-react";
import { ComposerModal } from "@/components/ComposerModal";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { toBackground, type Background } from "@/components/StatusCard";
import { PostCard, type FeedPost } from "@/components/PostCard";
import { VerificationBadge } from "@/components/VerificationBadge";
import { PitchModal, type PitchTarget } from "@/components/PitchModal";
import { useAuth } from "@/hooks/use-auth";
import type { RoleType, VerificationTier } from "@/hooks/use-auth";
import { useCardExport } from "@/hooks/use-card-export";
import { ROLE_LABEL, ROLE_OPTIONS } from "@/lib/roles";
import { useServerFn } from "@tanstack/react-start";
import { startConversation } from "@/lib/messaging.functions";
import {
  submitVerificationApplication,
  recheckVerificationProof,
  getVerificationProof,
} from "@/lib/verification.functions";
import { blockMember, unblockMember } from "@/lib/social.functions";
import {
  fetchFollowCounts,
  fetchRelationship,
  followMember,
  muteMember,
  unfollowMember,
  unmuteMember,
  type FollowCounts,
  type Relationship,
} from "@/lib/social";
import { describeWriteError } from "@/lib/db-errors";
import { timeAgo } from "@/lib/time";
import { AvatarPicker } from "@/components/AvatarPicker";
import { tierVisual } from "@/lib/tier-style";
import { SkillsInput } from "@/components/SkillsInput";
import { FollowList } from "@/components/FollowList";
import { SavedPosts } from "@/components/SavedPosts";
import { AVAILABILITY_LABEL, AVAILABILITY_OPTIONS } from "@/lib/roles";

const PROFILE_TABS = [
  "posts",
  "comments",
  "likes",
  "saved",
  "followers",
  "following",
  "edit",
  "verification",
] as const;

export const Route = createFileRoute("/u/$handle")({
  head: ({ params }) => ({
    meta: [
      { title: `@${params.handle} · The Ledger` },
      { name: "description", content: `Public profile and status cards from @${params.handle}.` },
      { property: "og:title", content: `@${params.handle} on The Ledger` },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    tab: PROFILE_TABS.find((t) => t === search.tab),
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
  hide_from_search: boolean;
  pitch_limit: number | null;
  dm_cloaking_enabled: boolean;
  skills: string[] | null;
  location: string | null;
  availability_status: string | null;
};

/** A pinned project, in the order the owner arranged them. */
type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  url: string | null;
  repo_url: string | null;
};

type PostRow = {
  id: string;
  content: string;
  background: Background;
  comments_enabled: boolean;
  visibility: string;
  created_at: string;
  edited_at: string | null;
};

type CommentRow = {
  id: string;
  content: string;
  created_at: string;
  post_id: string;
};

type LikedPostRow = {
  id: string;
  content: string;
  background: Background;
  comments_enabled: boolean;
  visibility: string;
  created_at: string;
  edited_at: string | null;
  author_id: string;
  author_display_name: string;
  author_handle: string;
  author_avatar_url: string | null;
  author_verification_tier: VerificationTier;
};

/**
 * Follower / following totals.
 *
 * Shown on both the owner's and the visitor's view of a profile, because a count
 * that appears only to strangers is an odd thing to hide from the person it
 * describes. Renders a placeholder dash until the counts arrive rather than a
 * zero, so the numbers never appear to drop from 0 to their real value.
 */
function FollowCounts({
  counts,
  onOpen,
}: {
  counts: FollowCounts | null;
  /** Counts that cannot be opened are just trivia; this is how the graph is browsed. */
  onOpen: (mode: "followers" | "following") => void;
}) {
  const cell = (value: number | null, label: string, mode: "followers" | "following") => (
    <button
      type="button"
      onClick={() => onOpen(mode)}
      className="inline-flex items-baseline gap-1 rounded transition-opacity hover:opacity-80"
    >
      <span className="text-[13px] font-semibold tabular-nums text-foreground">
        {value === null ? "—" : value.toLocaleString()}
      </span>
      <span className="text-[12px] text-tertiary">{label}</span>
    </button>
  );

  return (
    <div className="mt-3 flex items-center gap-4">
      {cell(
        counts?.followers ?? null,
        counts?.followers === 1 ? "follower" : "followers",
        "followers",
      )}
      {cell(counts?.following ?? null, "following", "following")}
    </div>
  );
}

// Main page component
function ProfilePage() {
  const { requestExport, exportSurface } = useCardExport();
  const { handle } = Route.useParams();
  const { user, profile: me, refreshProfile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const start = useServerFn(startConversation);

  const { tab } = Route.useSearch();
  const [profile, setProfile] = useState<ProfileRow | null | undefined>(undefined);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [likedPosts, setLikedPosts] = useState<LikedPostRow[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [busyMsg, setBusyMsg] = useState(false);
  const [showPitchModal, setShowPitchModal] = useState(false);

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [counts, setCounts] = useState<FollowCounts | null>(null);
  const [rel, setRel] = useState<Relationship | null>(null);
  const [busyFollow, setBusyFollow] = useState(false);
  const [busySafety, setBusySafety] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const block = useServerFn(blockMember);
  const unblock = useServerFn(unblockMember);

  // Inject <meta name="robots" content="noindex"> when the viewed profile
  // has opted out of search-engine indexing.
  useEffect(() => {
    if (!profile?.hide_from_search) return;
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, [profile?.hide_from_search]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: pf, error } = await supabase
        .from("profiles")
        .select(
          "id, handle, display_name, avatar_url, bio, company_name, role_type, verification_tier, github_url, portfolio_url, startup_url, traction_url, hide_from_search, pitch_limit, dm_cloaking_enabled, skills, location, availability_status",
        )
        .eq("handle", handle)
        .maybeSingle();
      if (cancelled) return;
      if (error || !pf) {
        setProfile(null);
        return;
      }
      setProfile(pf as ProfileRow);

      // Pinned projects — public, and ordered the way the owner arranged them.
      const { data: projectData } = await supabase
        .from("profile_projects")
        .select("id, name, description, url, repo_url")
        .eq("user_id", pf.id)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (cancelled) return;
      setProjects((projectData ?? []) as ProjectRow[]);

      // Posts
      const { data: postsData } = await supabase
        .from("posts")
        .select("id, content, background, comments_enabled, visibility, created_at, edited_at")
        .eq("author_id", pf.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (cancelled) return;
      setPosts((postsData ?? []) as PostRow[]);

      // Comments by this user
      const { data: commentsData } = await supabase
        .from("comments")
        .select("id, content, created_at, post_id")
        .eq("author_id", pf.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (cancelled) return;
      setComments((commentsData ?? []) as CommentRow[]);

      // Posts this user has liked
      const { data: likesData } = await supabase
        .from("likes")
        .select("post_id")
        .eq("user_id", pf.id)
        .limit(30);
      if (cancelled) return;
      if (likesData && likesData.length > 0) {
        const postIds = likesData.map((l) => l.post_id).filter(Boolean);
        if (postIds.length > 0) {
          const { data: likedPostsRaw } = await supabase
            .from("posts")
            .select(
              "id, content, background, comments_enabled, visibility, created_at, edited_at, author_id, profiles!posts_author_id_fkey(display_name, handle, avatar_url, verification_tier)",
            )
            .in("id", postIds)
            .order("created_at", { ascending: false });
          if (!cancelled) {
            const shaped = (likedPostsRaw ?? []).map((p) => ({
              id: p.id,
              content: p.content,
              background: toBackground(p.background),
              comments_enabled: p.comments_enabled ?? true,
              visibility: p.visibility ?? "public",
              created_at: p.created_at,
              edited_at: p.edited_at,
              author_id: p.author_id,
              author_display_name: p.profiles?.display_name ?? "Unknown",
              author_handle: p.profiles?.handle ?? "unknown",
              author_avatar_url: p.profiles?.avatar_url ?? null,
              author_verification_tier: (p.profiles?.verification_tier ??
                "none") as VerificationTier,
            }));
            setLikedPosts(shaped);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle]);

  /*
    Follow counts, and how the viewer stands towards this profile.

    Separate from the main profile effect because it depends on the viewer as well
    as the handle: signing in on an already-open profile page has to refresh the
    Follow button, which would not happen if this were folded into the fetch keyed
    on `handle` alone.
  */
  useEffect(() => {
    const profileId = profile?.id;
    if (!profileId) return;

    let cancelled = false;
    (async () => {
      const [nextCounts, nextRel] = await Promise.all([
        fetchFollowCounts(profileId),
        user && user.id !== profileId
          ? fetchRelationship(user.id, profileId)
          : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setCounts(nextCounts);
      setRel(nextRel);
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.id, user]);

  async function toggleFollow() {
    if (!user || !profile) {
      toast.error("Sign in to follow builders.");
      return;
    }
    const wasFollowing = rel?.following ?? false;
    setBusyFollow(true);

    const error = wasFollowing
      ? await unfollowMember(user.id, profile.id)
      : await followMember(user.id, profile.id);

    setBusyFollow(false);

    if (error) {
      toast.error(describeWriteError(error, wasFollowing ? "unfollow" : "follow builders"));
      return;
    }

    setRel((prev) => ({ ...(prev ?? { blocked: false, muted: false }), following: !wasFollowing }));
    // Adjust the visible count rather than refetching — one fewer round trip, and
    // the number the viewer just changed is the one they are looking at.
    setCounts((prev) =>
      prev ? { ...prev, followers: Math.max(0, prev.followers + (wasFollowing ? -1 : 1)) } : prev,
    );
  }

  async function toggleMute() {
    if (!user || !profile) return;
    const wasMuted = rel?.muted ?? false;
    setBusySafety(true);
    const error = wasMuted
      ? await unmuteMember(user.id, profile.id)
      : await muteMember(user.id, profile.id);
    setBusySafety(false);
    setMenuOpen(false);

    if (error) {
      toast.error(describeWriteError(error, "do that"));
      return;
    }
    setRel((prev) => ({ ...(prev ?? { following: false, blocked: false }), muted: !wasMuted }));
    toast.success(
      wasMuted
        ? `@${profile.handle} is no longer muted.`
        : `Muted @${profile.handle}. Their posts won't appear in your feed.`,
    );
  }

  async function toggleBlock() {
    if (!user || !profile) return;
    const wasBlocked = rel?.blocked ?? false;
    setBusySafety(true);
    try {
      if (wasBlocked) {
        await unblock({ data: { targetId: profile.id } });
      } else {
        await block({ data: { targetId: profile.id } });
      }
      // Blocking severs the follow in both directions, so the button and the
      // follower count both have to come back down with it.
      setRel((prev) => ({
        following: wasBlocked ? (prev?.following ?? false) : false,
        muted: prev?.muted ?? false,
        blocked: !wasBlocked,
      }));
      setCounts(await fetchFollowCounts(profile.id));
      toast.success(
        wasBlocked
          ? `Unblocked @${profile.handle}.`
          : `Blocked @${profile.handle}. You won't see each other's posts.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update that.");
    } finally {
      setBusySafety(false);
      setMenuOpen(false);
    }
  }

  async function message() {
    if (!user || !me || !profile) {
      toast.error("Sign in to send a message.");
      return;
    }
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

  // Loading / not-found states — wait for BOTH the handle query AND auth to resolve
  // before deciding "not found", so we can redirect a logged-in user to their real handle.
  if (profile === undefined || authLoading) {
    return (
      <div className="min-h-screen">
        <AppHeader />
        <div className="mx-auto max-w-5xl px-4 pt-10 pb-mobile-nav sm:px-6">
          {/* Profile header skeleton */}
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
            <div className="h-20 w-20 shrink-0 animate-pulse rounded-full bg-secondary/60 sm:h-24 sm:w-24" />
            <div className="flex-1 space-y-3 pt-1">
              <div className="h-5 w-44 animate-pulse rounded-full bg-secondary/60" />
              <div className="h-3.5 w-24 animate-pulse rounded-full bg-secondary/40" />
              <div className="space-y-2 pt-1">
                <div className="h-3 w-full max-w-xs animate-pulse rounded-full bg-secondary/40" />
                <div className="h-3 w-3/4 max-w-xs animate-pulse rounded-full bg-secondary/30" />
              </div>
              <div className="flex gap-2 pt-2">
                <div className="h-8 w-24 animate-pulse rounded-xl bg-secondary/50" />
                <div className="h-8 w-24 animate-pulse rounded-xl bg-secondary/30" />
              </div>
            </div>
          </div>
          {/* Posts skeleton */}
          <div className="mt-10 space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-2xl border border-border/40 bg-card/30 p-5">
                <div className="flex items-start gap-3">
                  <div
                    className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-secondary/60"
                    style={{ animationDelay: `${i * 60}ms` }}
                  />
                  <div className="flex-1 space-y-2.5">
                    <div
                      className="h-3 w-32 animate-pulse rounded-full bg-secondary/60"
                      style={{ animationDelay: `${i * 60 + 30}ms` }}
                    />
                    <div
                      className="h-3 w-full animate-pulse rounded-full bg-secondary/40"
                      style={{ animationDelay: `${i * 60 + 60}ms` }}
                    />
                    <div
                      className="h-3 w-4/5 animate-pulse rounded-full bg-secondary/30"
                      style={{ animationDelay: `${i * 60 + 90}ms` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (profile === null) {
    // A signed-in visitor used to be bounced to their OWN profile whenever the
    // requested handle didn't resolve, so a typo or a deleted account looked like
    // the URL had been hijacked and "Profile not found" was unreachable for
    // anyone logged in. Show the honest answer instead.
    //
    // Logged-in user with no completed profile → send to onboarding
    if (user && !me) {
      return (
        <div className="min-h-screen">
          <AppHeader />
          <div className="mx-auto max-w-5xl px-6 pt-16">
            <h1 className="text-xl font-semibold">Finish setting up your profile</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Complete onboarding to claim your handle and access your profile.
            </p>
            <Link
              to="/onboarding"
              className="mt-6 inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
              style={{ background: "#F5F5F6" }}
            >
              Complete setup
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen">
        <AppHeader />
        <div className="mx-auto max-w-5xl px-6 pt-16">
          <h1 className="text-xl font-semibold">Profile not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            No one on The Ledger uses the handle @{handle}.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
            <Link to="/feed" className="underline underline-offset-4">
              Back to the feed
            </Link>
            {me?.handle ? (
              <Link
                to="/u/$handle"
                params={{ handle: me.handle }}
                search={{ tab: undefined }}
                className="underline underline-offset-4"
              >
                Go to your profile
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const isSelf = user?.id === profile.id;
  const isGold = profile.verification_tier === "gold";
  const viewerIsSilverOrGold =
    me?.verification_tier === "silver" || me?.verification_tier === "gold";
  const dmCloaked = (profile.dm_cloaking_enabled ?? false) && !isSelf && !viewerIsSilverOrGold;

  const connectLinks = [
    profile.github_url ? { label: "GitHub", href: profile.github_url, icon: Github } : null,
    profile.startup_url ? { label: "Startup", href: profile.startup_url, icon: Rocket } : null,
  ].filter(Boolean) as { label: string; href: string; icon: typeof Github }[];

  const pitchTarget: PitchTarget = {
    id: profile.id,
    handle: profile.handle,
    display_name: profile.display_name,
    avatar_url: profile.avatar_url,
    verification_tier: profile.verification_tier,
    company_name: profile.company_name,
    pitch_limit: profile.pitch_limit ?? null,
  };

  // SELF VIEW
  if (isSelf && me) {
    type SelfTab = "posts" | "comments" | "likes" | "saved" | "followers" | "following";
    const activeTab: SelfTab =
      tab === "comments" ||
      tab === "likes" ||
      tab === "saved" ||
      tab === "followers" ||
      tab === "following"
        ? tab
        : "posts";

    function setTab(t: SelfTab) {
      navigate({ to: "/u/$handle", params: { handle }, search: { tab: t } });
    }

    /*
      Four tabs in the bar, not six. Followers and Following are reached by tapping
      the counts above — putting six tabs across a 390px viewport makes each one a
      cramped target, and the counts are the affordance people already reach for.
    */
    const PROFILE_TABS = [
      { key: "posts" as const, label: "Posts", icon: FileText },
      { key: "comments" as const, label: "Comments", icon: MessageSquare },
      { key: "likes" as const, label: "Likes", icon: Heart },
      { key: "saved" as const, label: "Saved", icon: Bookmark },
    ];

    return (
      <div className="min-h-screen">
        <AppHeader />
        <main className="mx-auto max-w-2xl pb-mobile-nav">
          {/* Cover banner */}
          <div
            className="h-28 sm:h-36 w-full"
            /* Was amber for everybody. Your own profile telling you that you are
               gold-tier when you are not is the most misleading place to do it. */
            style={{ background: tierVisual(me.verification_tier).cover }}
          />

          {/* Profile header */}
          <div className="px-4 sm:px-6">
            {/* Avatar + action buttons row */}
            <div className="flex items-end justify-between -mt-10 sm:-mt-12 mb-4">
              {/* Avatar */}
              <div
                className="h-20 w-20 sm:h-24 sm:w-24 rounded-full overflow-hidden shrink-0 text-2xl font-semibold grid"
                style={{
                  border: "4px solid var(--bg-base)",
                  background: "rgba(255,255,255,0.06)",
                  boxShadow: `0 0 0 2px ${tierVisual(me.verification_tier).ring}`,
                }}
              >
                {me.avatar_url ? (
                  <img
                    src={me.avatar_url}
                    alt=""
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="grid h-full w-full place-items-center text-2xl">
                    {me.display_name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>

              {/* Buttons */}
              <div className="flex items-center gap-2 pb-1">
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="rounded-full px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-white/10"
                  style={{ border: "1px solid rgba(255,255,255,0.30)", color: "inherit" }}
                >
                  Edit profile
                </button>
                {/*
                  Shown only to members who do not hold a badge yet — for everyone
                  else it would be a button that leads to a page telling them they
                  have nothing to do. This is the most likely place someone looks
                  for it, which is why it is on the profile and not only in a menu.
                */}
                {me.verification_tier === "none" && (
                  <Link
                    to="/verification"
                    search={{ fee: undefined }}
                    className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-white/10"
                    style={{ border: "1px solid rgba(255,255,255,0.30)", color: "inherit" }}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Get verified
                  </Link>
                )}
              </div>
            </div>

            {/* Name / handle / bio */}
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
              {me.display_name}
              <VerificationBadge tier={me.verification_tier} size={18} />
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              @{me.handle}
              {me.role_type ? ` · ${ROLE_LABEL[me.role_type]}` : ""}
            </p>
            {me.bio && <p className="mt-2 max-w-prose text-sm text-foreground/85">{me.bio}</p>}
            <DeveloperDetails
              skills={me.skills}
              location={me.location}
              availability={me.availability_status}
              projects={projects}
            />
            <FollowCounts
              counts={counts}
              onOpen={(mode) =>
                navigate({ to: "/u/$handle", params: { handle }, search: { tab: mode } })
              }
            />
          </div>

          {/* Tab bar */}
          <div
            className="sticky top-[57px] z-10 mt-5 flex border-b"
            style={{
              borderColor: "rgba(255,255,255,0.08)",
              background: "rgba(11,11,12,0.90)",
              backdropFilter: "blur(12px)",
            }}
          >
            {PROFILE_TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className="relative flex flex-1 items-center justify-center gap-1.5 py-3.5 text-sm font-medium transition-colors"
                style={{
                  color: activeTab === key ? "var(--foreground)" : "var(--text-secondary)",
                }}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                {activeTab === key && (
                  <span
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] w-12 rounded-full"
                    style={{ background: "var(--foreground)" }}
                  />
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="px-4 sm:px-6 py-6 pb-28">
            {/* POSTS */}
            {activeTab === "posts" &&
              (posts.length === 0 ? (
                <div
                  className="flex flex-col items-center rounded-2xl py-16 text-center"
                  style={{ border: "1px dashed rgba(255,255,255,0.10)" }}
                >
                  <FileText className="h-8 w-8 text-muted-foreground/40 mb-3" />
                  <p className="text-sm font-medium">No posts yet.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Head to Studio to write your first card.
                  </p>
                  <Link
                    to="/studio"
                    search={{ draft: undefined }}
                    className="mt-4 rounded-xl px-4 py-2 text-xs font-medium text-background transition-opacity hover:opacity-90"
                    style={{ background: "#F5F5F6" }}
                  >
                    Open Studio
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {posts.map((p) => {
                    const feedPost: FeedPost = {
                      id: p.id,
                      content: p.content,
                      background: p.background,
                      comments_enabled: p.comments_enabled,
                      visibility: p.visibility,
                      created_at: p.created_at,
                      edited_at: p.edited_at,
                      author: {
                        id: profile.id,
                        handle: profile.handle,
                        display_name: profile.display_name,
                        avatar_url: profile.avatar_url,
                        verification_tier: profile.verification_tier,
                      },
                    };
                    return (
                      <PostCard
                        key={p.id}
                        post={feedPost}
                        currentUserId={user?.id}
                        onDownload={requestExport}
                        onDeleted={(id) => setPosts((prev) => prev.filter((x) => x.id !== id))}
                        onEdited={(id, content, editedAt) =>
                          setPosts((prev) =>
                            prev.map((x) =>
                              x.id === id ? { ...x, content, edited_at: editedAt } : x,
                            ),
                          )
                        }
                      />
                    );
                  })}
                </div>
              ))}

            {/* COMMENTS */}
            {activeTab === "comments" &&
              (comments.length === 0 ? (
                <div
                  className="flex flex-col items-center rounded-2xl py-16 text-center"
                  style={{ border: "1px dashed rgba(255,255,255,0.10)" }}
                >
                  <MessageSquare className="h-8 w-8 text-muted-foreground/40 mb-3" />
                  <p className="text-sm font-medium">No comments yet.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Jump into the feed and start a conversation.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {comments.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-2xl p-4"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.07)",
                      }}
                    >
                      <div className="flex items-start gap-3">
                        {/* Small avatar */}
                        <div
                          className="h-8 w-8 shrink-0 rounded-full grid overflow-hidden text-[11px] font-semibold"
                          style={{
                            background: "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.10)",
                          }}
                        >
                          {me.avatar_url ? (
                            <img
                              src={me.avatar_url}
                              alt=""
                              className="h-full w-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span className="grid h-full w-full place-items-center">
                              {me.display_name.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-xs font-semibold">{me.display_name}</span>
                            <VerificationBadge tier={me.verification_tier} size={11} />
                            <span className="text-[11px] text-muted-foreground">
                              · {timeAgo(c.created_at)}
                            </span>
                          </div>
                          <p className="text-sm text-foreground/85 break-words">{c.content}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}

            {/* FOLLOWERS / FOLLOWING — opened from the counts above */}
            {(activeTab === "followers" || activeTab === "following") && (
              <div>
                <div className="segmented mb-4 sm:max-w-[16rem]">
                  {(["followers", "following"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setTab(m)}
                      data-active={activeTab === m}
                      className="segmented-item"
                    >
                      {m === "followers" ? "Followers" : "Following"}
                    </button>
                  ))}
                </div>
                <FollowList profileId={me.id} mode={activeTab} />
              </div>
            )}

            {/* SAVED — private to the owner, enforced by the bookmarks policies */}
            {activeTab === "saved" && <SavedPosts userId={me.id} />}

            {/* LIKES */}
            {activeTab === "likes" &&
              (likedPosts.length === 0 ? (
                <div
                  className="flex flex-col items-center rounded-2xl py-16 text-center"
                  style={{ border: "1px dashed rgba(255,255,255,0.10)" }}
                >
                  <Heart className="h-8 w-8 text-muted-foreground/40 mb-3" />
                  <p className="text-sm font-medium">No likes yet.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Like posts in the feed and they'll appear here.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {likedPosts.map((p) => {
                    const feedPost: FeedPost = {
                      id: p.id,
                      content: p.content,
                      background: p.background,
                      comments_enabled: p.comments_enabled,
                      visibility: p.visibility,
                      created_at: p.created_at,
                      edited_at: p.edited_at,
                      author: {
                        id: p.author_id,
                        handle: p.author_handle,
                        display_name: p.author_display_name,
                        avatar_url: p.author_avatar_url,
                        verification_tier: p.author_verification_tier,
                      },
                    };
                    return (
                      <PostCard
                        key={p.id}
                        post={feedPost}
                        currentUserId={user?.id}
                        onDownload={requestExport}
                      />
                    );
                  })}
                </div>
              ))}
          </div>
        </main>

        {/* Floating compose button */}
        {user && (
          <button
            type="button"
            onClick={() => setShowComposer(true)}
            aria-label="Write a new card"
            className="fixed right-5 z-40 flex items-center justify-center rounded-full shadow-2xl transition-all duration-300 sm:right-8"
            style={{
              bottom: "calc(env(safe-area-inset-bottom) + 72px)",
              width: "52px",
              height: "52px",
              background: "#F5F5F6",
              color: "#0B0B0C",
              boxShadow: "0 8px 32px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.30)",
            }}
          >
            <Plus className="h-5 w-5" strokeWidth={2.5} />
          </button>
        )}

        {/* Composer modal */}
        {showComposer && (
          <ComposerModal
            onClose={() => setShowComposer(false)}
            onPublished={(post) => {
              setPosts((prev) => [
                {
                  id: post.id,
                  content: post.content,
                  background: post.background,
                  comments_enabled: post.comments_enabled ?? true,
                  visibility: post.visibility ?? "public",
                  created_at: post.created_at,
                  // Brand new, so it cannot have been edited yet.
                  edited_at: null,
                },
                ...prev,
              ]);
            }}
          />
        )}

        {/* Edit Profile bottom sheet */}
        {editOpen && (
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center"
            style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
          >
            <div
              className="w-full sm:max-w-lg sm:rounded-3xl overflow-y-auto max-h-[92vh]"
              style={{
                background: "#0B0B0C",
                border: "1px solid rgba(255,255,255,0.08)",
                borderBottom: "none",
                borderRadius: "24px 24px 0 0",
              }}
            >
              {/* Header */}
              <div
                className="sticky top-0 z-10 flex items-center justify-between px-5 py-4"
                style={{
                  background: "rgba(11,11,12,0.95)",
                  borderBottom: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <h2 className="text-base font-semibold">Edit profile</h2>
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                  style={{ background: "rgba(255,255,255,0.06)" }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {/* Edit form */}
              <div className="px-5 py-6">
                <EditProfileForm
                  profile={me}
                  onSaved={async () => {
                    await refreshProfile();
                    setEditOpen(false);
                  }}
                />
                {/*
                  A link, not the form itself. The whole verification portal used to
                  be embedded here, below the Save button of an unrelated form, and
                  it was the only way to reach it — which is exactly why nobody
                  could find it. It has its own route now.
                */}
                <div
                  className="mt-6 pt-5"
                  style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <Link
                    to="/verification"
                    search={{ fee: undefined }}
                    className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-white/[0.03]"
                    style={{ border: "1px solid rgba(255,255,255,0.07)" }}
                  >
                    <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1">
                      <span className="block text-sm font-medium text-foreground">
                        Verification
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {me.verification_tier === "none"
                          ? "Apply for a Silver or Gold badge"
                          : `You hold ${me.verification_tier === "gold" ? "Gold" : "Silver"} verification`}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // PUBLIC PROFILE VIEW
  return (
    <div className="min-h-screen">
      <AppHeader />

      {/*
        Cover band, tinted by tier. The self view has always opened with one, so
        without it the same profile changed shape depending on who was looking:
        a banner and an overlapping avatar for the owner, a flat row for everyone
        else.
      */}
      <div
        className="h-24 w-full sm:h-28"
        style={{
          background: tierVisual(profile.verification_tier).cover,
        }}
      />

      <main className="mx-auto max-w-5xl px-4 pb-mobile-nav sm:px-6">
        <header className="-mt-10 flex flex-col items-start gap-5 sm:-mt-12 sm:flex-row sm:items-end">
          {/* Avatar — tier ring, matching the header and the self view */}
          <div
            className="grid h-20 w-20 shrink-0 overflow-hidden rounded-full text-2xl font-semibold sm:h-24 sm:w-24"
            style={{
              border: "4px solid var(--bg-base)",
              background: "rgba(255,255,255,0.05)",
              boxShadow: `0 0 0 2px ${tierVisual(profile.verification_tier).ring}`,
            }}
          >
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
            {profile.bio && (
              <p className="mt-2 max-w-prose text-sm text-foreground/90">{profile.bio}</p>
            )}
            <FollowCounts
              counts={counts}
              onOpen={(mode) =>
                navigate({ to: "/u/$handle", params: { handle }, search: { tab: mode } })
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/*
              Follow, first in the row because it is the action a visitor is most
              likely to want. Hidden once blocked: following someone you have
              blocked is a contradiction, and the INSERT policy would refuse it
              anyway — better not to offer it than to offer it and fail.
            */}
            {user && me && !rel?.blocked && (
              <button
                type="button"
                onClick={toggleFollow}
                disabled={busyFollow}
                aria-pressed={rel?.following ?? false}
                className={rel?.following ? "btn btn-outline btn-sm" : "btn btn-primary btn-sm"}
              >
                {busyFollow ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : rel?.following ? (
                  <UserCheck className="h-4 w-4" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                {rel?.following ? "Following" : "Follow"}
              </button>
            )}
            {profile.verification_tier !== "none" &&
              !dmCloaked &&
              connectLinks.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
                  style={{ borderColor: "rgba(255,255,255,0.10)" }}
                >
                  <l.icon className="h-4 w-4" /> {l.label}
                </a>
              ))}

            {isGold && viewerIsSilverOrGold && user && me && (
              <button
                type="button"
                onClick={() => setShowPitchModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/10"
                style={{
                  border: "1px solid rgba(251,191,36,0.30)",
                  background: "rgba(251,191,36,0.07)",
                }}
              >
                <Rocket className="h-4 w-4" /> Pitch
              </button>
            )}

            {user && me && !dmCloaked && (
              <button
                type="button"
                onClick={message}
                disabled={busyMsg}
                className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                <MessageSquare className="h-4 w-4" /> Message
              </button>
            )}

            {/*
              Mute and block, behind an overflow menu.

              Kept out of the primary row deliberately: these are rare, weighty
              actions, and a Block button sitting next to Follow invites misclicks.
              The two do different things and the copy has to say so — a mute
              quiets the feed, a block removes you from each other entirely.
            */}
            {user && me && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="More actions"
                  className="btn btn-outline btn-sm !px-2.5"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>

                {menuOpen && (
                  <>
                    {/* Click-away layer, so the menu closes without a document
                        listener that would also swallow the toggle's own click. */}
                    <button
                      type="button"
                      aria-hidden="true"
                      tabIndex={-1}
                      onClick={() => setMenuOpen(false)}
                      className="fixed inset-0 z-40 cursor-default"
                    />
                    <div
                      role="menu"
                      className="absolute right-0 z-50 mt-1 w-60 overflow-hidden rounded-xl p-1 shadow-2xl"
                      style={{
                        background: "var(--surface-1, #141416)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={toggleMute}
                        disabled={busySafety}
                        className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-2)] disabled:opacity-50"
                      >
                        {rel?.muted ? (
                          <Volume2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <VolumeX className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span>
                          <span className="block text-[13px] font-medium">
                            {rel?.muted ? "Unmute" : "Mute"} @{profile.handle}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-tertiary">
                            {rel?.muted
                              ? "Their posts return to your feed."
                              : "Hides their posts from your feed. They aren't told."}
                          </span>
                        </span>
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={toggleBlock}
                        disabled={busySafety}
                        className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-2)] disabled:opacity-50"
                      >
                        <Ban className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                        <span>
                          <span className="block text-[13px] font-medium text-red-400">
                            {rel?.blocked ? "Unblock" : "Block"} @{profile.handle}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-tertiary">
                            {rel?.blocked
                              ? "You'll be able to see each other again. Follows aren't restored."
                              : "Hides both of you from each other and breaks any follow between you."}
                          </span>
                        </span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </header>

        {/*
          Said out loud, because the consequence is otherwise indistinguishable
          from an empty profile: once blocked, can_view_post() hides their posts, so
          the timeline below is legitimately empty rather than broken.
        */}
        {rel?.blocked && (
          <div
            className="mt-6 flex items-start gap-3 rounded-xl p-4"
            style={{
              border: "1px solid rgba(248,113,113,0.25)",
              background: "rgba(248,113,113,0.06)",
            }}
          >
            <Ban className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <div className="text-xs leading-relaxed">
              <p className="font-semibold text-red-300">You've blocked @{profile.handle}</p>
              <p className="mt-1 text-muted-foreground">
                Neither of you can see the other's posts, reply, or send messages. Unblock from the
                menu above to undo this.
              </p>
            </div>
          </div>
        )}

        {tab === "followers" || tab === "following" ? (
          <section className="mt-8">
            <div className="segmented mb-4 sm:max-w-[16rem]">
              {(["followers", "following"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() =>
                    navigate({ to: "/u/$handle", params: { handle }, search: { tab: m } })
                  }
                  data-active={tab === m}
                  className="segmented-item"
                >
                  {m === "followers" ? "Followers" : "Following"}
                </button>
              ))}
            </div>
            <FollowList profileId={profile.id} mode={tab} />
          </section>
        ) : (
          <>
            <DeveloperDetails
              skills={profile.skills}
              location={profile.location}
              availability={profile.availability_status}
              projects={projects}
            />

            {/* Cards grid */}
            <section className="mt-10">
              <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Cards
              </h2>
              {posts.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">Nothing published yet.</p>
              ) : (
                <div className="mt-4 space-y-4">
                  {posts.map((p) => {
                    const feedPost: FeedPost = {
                      id: p.id,
                      content: p.content,
                      background: p.background,
                      comments_enabled: p.comments_enabled,
                      visibility: p.visibility,
                      created_at: p.created_at,
                      edited_at: p.edited_at,
                      author: {
                        id: profile.id,
                        handle: profile.handle,
                        display_name: profile.display_name,
                        avatar_url: profile.avatar_url,
                        verification_tier: profile.verification_tier,
                      },
                    };
                    return (
                      <PostCard
                        key={p.id}
                        post={feedPost}
                        currentUserId={user?.id}
                        onDownload={requestExport}
                        onDeleted={(id) => setPosts((prev) => prev.filter((x) => x.id !== id))}
                        onEdited={(id, content, editedAt) =>
                          setPosts((prev) =>
                            prev.map((x) =>
                              x.id === id ? { ...x, content, edited_at: editedAt } : x,
                            ),
                          )
                        }
                      />
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {showPitchModal && user && me && (
        <PitchModal
          target={pitchTarget}
          senderId={user.id}
          onClose={() => setShowPitchModal(false)}
        />
      )}

      {exportSurface}
    </div>
  );
}

/**
 * The part of a profile that says what someone builds.
 *
 * Kept as one block used by both the owner's and the visitor's view, because the
 * two views of a profile drifting apart is a bug this file has already had once.
 * Renders nothing at all when there is nothing to say — an empty "Skills" heading
 * is worse than no heading.
 */
function DeveloperDetails({
  skills,
  location,
  availability,
  projects,
}: {
  skills: string[] | null;
  location: string | null;
  availability: string | null;
  projects: ProjectRow[];
}) {
  const hasSkills = (skills?.length ?? 0) > 0;
  const hasProjects = projects.length > 0;
  if (!hasSkills && !location && !availability && !hasProjects) return null;

  return (
    <div className="mt-6 space-y-6">
      {(location || availability) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
          {location && (
            <span className="inline-flex items-center gap-1.5 text-secondary">
              <MapPin className="h-3.5 w-3.5 text-tertiary" />
              {location}
            </span>
          )}
          {availability && AVAILABILITY_LABEL[availability] && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium"
              style={{
                background: "rgba(52,211,153,0.10)",
                color: "#34d399",
                border: "1px solid rgba(52,211,153,0.22)",
              }}
            >
              {AVAILABILITY_LABEL[availability]}
            </span>
          )}
        </div>
      )}

      {hasSkills && (
        <div>
          <h2 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-tertiary">
            <Code2 className="h-3 w-3" />
            Builds with
          </h2>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {skills!.map((skill) => (
              /* Each skill links into search, which is what makes them worth
                 storing: a tag you cannot follow to other people is decoration. */
              <Link
                key={skill}
                to="/search"
                search={{ q: skill, tab: "people" }}
                className="rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors"
                style={{
                  background: "rgba(251,191,36,0.10)",
                  color: "var(--gold)",
                  border: "1px solid rgba(251,191,36,0.20)",
                }}
              >
                {skill}
              </Link>
            ))}
          </div>
        </div>
      )}

      {hasProjects && (
        <div>
          <h2 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-tertiary">
            <FolderGit2 className="h-3 w-3" />
            Pinned work
          </h2>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
            {projects.map((proj) => (
              <div key={proj.id} className="card p-3.5">
                <p className="text-[13px] font-semibold text-foreground">{proj.name}</p>
                {proj.description && (
                  <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-secondary">
                    {proj.description}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                  {proj.url && (
                    <a
                      href={proj.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-sky-400 hover:underline underline-offset-2"
                    >
                      <ExternalLink className="h-3 w-3" /> Live
                    </a>
                  )}
                  {proj.repo_url && (
                    <a
                      href={proj.repo_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-secondary hover:underline underline-offset-2"
                    >
                      <Github className="h-3 w-3" /> Code
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Owner-facing profile card, with an inline edit toggle. */
type SelfProfile = {
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
  skills: string[] | null;
  location: string | null;
  availability_status: string | null;
};

// Inline edit form
function EditProfileForm({
  profile,
  onSaved,
}: {
  profile: SelfProfile;
  onSaved: () => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [companyName, setCompanyName] = useState(profile.company_name ?? "");
  const [roleType, setRoleType] = useState<string>(profile.role_type ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url ?? "");
  const [githubUrl, setGithubUrl] = useState(profile.github_url ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(profile.portfolio_url ?? "");
  const [skills, setSkills] = useState<string[]>(profile.skills ?? []);
  const [location, setLocation] = useState(profile.location ?? "");
  const [availability, setAvailability] = useState(profile.availability_status ?? "");
  const [busy, setBusy] = useState(false);

  const roleOptions: { value: RoleType | ""; label: string }[] = [
    { value: "", label: "Not specified" },
    ...ROLE_OPTIONS,
  ];

  async function save() {
    if (!displayName.trim()) {
      toast.error("Display name is required.");
      return;
    }
    if (githubUrl && !/^https?:\/\//.test(githubUrl.trim())) {
      toast.error("GitHub URL must start with https://");
      return;
    }
    if (websiteUrl && !/^https?:\/\//.test(websiteUrl.trim())) {
      toast.error("Website URL must start with https://");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName.trim(),
        bio: bio.trim() || null,
        avatar_url: avatarUrl.trim() || null,
        company_name: companyName.trim() || null,
        role_type: roleType || null,
        github_url: githubUrl.trim() || null,
        portfolio_url: websiteUrl.trim() || null,
        skills,
        location: location.trim() || null,
        // "" is the placeholder option, and the CHECK only accepts a known value
        // or NULL — so an empty selection has to become NULL, not an empty string.
        availability_status: availability || null,
      })
      .eq("id", profile.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await onSaved();
    toast.success("Profile updated.");
  }

  return (
    <div className="space-y-4">
      {/* Avatar picker — upload or NFT-style PFP */}
      <div
        className="rounded-2xl p-4"
        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
      >
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Profile Photo
        </p>
        <AvatarPicker value={avatarUrl} onChange={setAvatarUrl} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Display Name">
          <input
            className="lux-field"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={60}
          />
        </Field>
        <Field label="Role Type">
          <select
            className="lux-field"
            value={roleType}
            onChange={(e) => setRoleType(e.target.value)}
          >
            {roleOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Company / Startup">
        <input
          className="lux-field"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          maxLength={80}
        />
      </Field>

      <Field label="Bio" hint="Max 200 characters.">
        <textarea
          rows={3}
          className="lux-field resize-y"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={200}
        />
      </Field>

      <Field label="Skills" hint="Languages, frameworks and tools. People search by these.">
        <SkillsInput value={skills} onChange={setSkills} disabled={busy} />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Location" hint="Optional. A city, a country, or just a timezone.">
          <input
            className="lux-field"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={80}
            placeholder="Lagos · remote"
          />
        </Field>
        <Field label="Open to">
          <select
            className="lux-field"
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
          >
            <option value="">Not saying</option>
            {AVAILABILITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div
        className="rounded-2xl p-1"
        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
      >
        <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Public Links
        </p>
        <div className="space-y-2 p-2">
          <input
            className="lux-field"
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            placeholder="GitHub URL (https://github.com/…)"
          />
          <input
            className="lux-field"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="Website / Portfolio URL"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{ background: "#F5F5F6" }}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Save Changes
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// Verification section

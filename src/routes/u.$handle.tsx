import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MessageSquare, Github, Rocket, Settings, ShieldCheck, Loader2, Pencil, X, CheckCircle2 } from "lucide-react";
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
  validateSearch: (s: Record<string, unknown>) => ({
    tab: (["posts", "edit", "verification"] as const).includes(s.tab as any)
      ? (s.tab as "posts" | "edit" | "verification")
      : undefined,
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
  dm_cloaking_enabled: boolean;
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

// ─── Auto-redirect to the user's real handle ─────────────────────────────────
function RedirectToOwnProfile({ handle }: { handle: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/u/$handle", params: { handle }, replace: true });
  }, [handle, navigate]);
  return null;
}

// ─── Main page component ──────────────────────────────────────────────────────
function ProfilePage() {
  const { handle } = Route.useParams();
  const { user, profile: me, refreshProfile, loading: authLoading } = useAuth();
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
        .select("id, handle, display_name, avatar_url, bio, company_name, role_type, verification_tier, github_url, portfolio_url, startup_url, traction_url, pitch_limit, dm_cloaking_enabled")
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
    } finally { setBusyMsg(false); }
  }

  // Loading / not-found states — wait for BOTH the handle query AND auth to resolve
  // before deciding "not found", so we can redirect a logged-in user to their real handle.
  if (profile === undefined || authLoading) {
    return (
      <div className="min-h-screen">
        <AppHeader />
        <div className="mx-auto max-w-5xl px-6 pt-16 text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (profile === null) {
    // If the signed-in user lands here but their real handle is different,
    // redirect them to their actual profile automatically.
    if (me && me.handle && me.handle !== handle) {
      return (
        <div className="min-h-screen">
          <AppHeader />
          <div className="mx-auto max-w-5xl px-6 pt-16">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Redirecting…</p>
            <RedirectToOwnProfile handle={me.handle} />
          </div>
        </div>
      );
    }
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
          <p className="mt-2 text-sm text-muted-foreground">No one on The Ledger uses the handle @{handle}.</p>
          <Link to="/feed" className="mt-6 inline-block text-sm underline underline-offset-4">
            Back to the feed
          </Link>
        </div>
      </div>
    );
  }

  const isSelf = user?.id === profile.id;
  const isGold = profile.verification_tier === "gold";
  const viewerIsSilverOrGold = me?.verification_tier === "silver" || me?.verification_tier === "gold";
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
    pitch_limit: (profile as any).pitch_limit ?? null,
  };

  // ── SELF VIEW ─────────────────────────────────────────────────────────────
  if (isSelf && me) {
    return (
      <div className="min-h-screen pb-16 sm:pb-0">
        <AppHeader />
        <main className="mx-auto max-w-2xl px-4 pt-10 pb-28 sm:px-6">

          {/* ── Profile Card ── */}
          <SelfProfileCard
            profile={me as any}
            onSaved={refreshProfile}
          />

          {/* ── Verification Portal ── */}
          <section className="mt-10">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Verification Portal
              </p>
            </div>
            <VerificationSection profile={me as any} />
          </section>

          {/* ── My Cards ── */}
          <section className="mt-10">
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              My Cards
            </p>
            {posts.length === 0 ? (
              <div
                className="flex flex-col items-center rounded-2xl py-12 text-center"
                style={{ border: "1px dashed rgba(255,255,255,0.10)" }}
              >
                <p className="text-sm font-medium">No cards published yet.</p>
                <p className="mt-1 text-xs text-muted-foreground">Head to Workspace to write your first card.</p>
                <Link
                  to="/studio"
                  search={{ draft: undefined }}
                  className="mt-4 rounded-xl px-4 py-2 text-xs font-medium text-background transition-opacity hover:opacity-90"
                  style={{ background: "#F5F5F6" }}
                >
                  Open Workspace
                </Link>
              </div>
            ) : (
              <div className="columns-1 gap-5 sm:columns-2 [column-fill:_balance]">
                {posts.map((p) => (
                  <div key={p.id} className="mb-5 break-inside-avoid">
                    <div className="overflow-hidden rounded-2xl" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                      <StatusCard
                        name={profile.display_name}
                        handle={profile.handle}
                        avatarUrl={profile.avatar_url}
                        content={p.content}
                        background={p.background}
                        verificationTier={profile.verification_tier}
                      />
                    </div>
                    <div className="mt-1.5 px-1 text-[11px] text-muted-foreground">{timeAgo(p.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    );
  }

  // ── PUBLIC PROFILE VIEW ────────────────────────────────────────────────────
  return (
    <div className="min-h-screen pb-16 sm:pb-0">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 pt-10 pb-24 sm:px-6">
        <header className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          {/* Avatar */}
          <div
            className="grid h-20 w-20 shrink-0 overflow-hidden rounded-full text-2xl font-semibold"
            style={{ border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.05)" }}
          >
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
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
          </div>

          <div className="flex flex-wrap gap-2">
            {profile.verification_tier !== "none" && !dmCloaked &&
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
                style={{ border: "1px solid rgba(251,191,36,0.30)", background: "rgba(251,191,36,0.07)" }}
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
          </div>
        </header>

        {/* Cards grid */}
        <section className="mt-10">
          <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Cards</h2>
          {posts.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Nothing published yet.</p>
          ) : (
            <div className="mt-6 columns-1 gap-6 sm:columns-2 lg:columns-3 [column-fill:_balance]">
              {posts.map((p) => (
                <div key={p.id} className="mb-6 break-inside-avoid">
                  <div className="overflow-hidden rounded-2xl" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                    <StatusCard
                      name={profile.display_name}
                      handle={profile.handle}
                      avatarUrl={profile.avatar_url}
                      content={p.content}
                      background={p.background}
                      verificationTier={profile.verification_tier}
                    />
                  </div>
                  <div className="mt-2 px-1 text-xs text-muted-foreground">{timeAgo(p.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

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

// ─── Self Profile Card (read-only → inline edit toggle) ───────────────────────
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
};

function SelfProfileCard({
  profile,
  onSaved,
}: {
  profile: SelfProfile;
  onSaved: () => Promise<void>;
}) {
  const [editMode, setEditMode] = useState(false);

  return (
    <div
      className="rounded-2xl p-5 sm:p-6"
      style={{ background: "rgba(26,26,30,0.70)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      {/* Hero row — always visible */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* Avatar */}
          <div
            className="grid h-16 w-16 shrink-0 overflow-hidden rounded-full text-xl font-semibold"
            style={{ border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.05)" }}
          >
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <span className="grid h-full w-full place-items-center">
                {profile.display_name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          {/* Name / handle / meta */}
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              {profile.display_name}
              <VerificationBadge tier={profile.verification_tier} size={18} />
            </h1>
            <p className="text-sm text-muted-foreground">
              @{profile.handle}
              {profile.role_type ? ` · ${ROLE_LABEL[profile.role_type]}` : ""}
              {profile.company_name ? ` · ${profile.company_name}` : ""}
            </p>
            {!editMode && profile.bio && (
              <p className="mt-1.5 max-w-sm text-sm text-foreground/80">{profile.bio}</p>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 items-center gap-2">
          {/* Edit / Cancel toggle */}
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {editMode ? (
              <><X className="h-3.5 w-3.5" />Cancel</>
            ) : (
              <><Pencil className="h-3.5 w-3.5" />Edit Profile</>
            )}
          </button>

          {/* Gear → Account Settings */}
          <Link
            to="/settings"
            aria-label="Account Settings"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:text-foreground"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <Settings className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Inline edit form */}
      {editMode && (
        <div className="mt-6 border-t pt-6" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
          <EditProfileForm
            profile={profile}
            onSaved={async () => {
              await onSaved();
              setEditMode(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Inline edit form ─────────────────────────────────────────────────────────
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
  const [busy, setBusy] = useState(false);

  const ROLE_OPTIONS: { value: RoleType | ""; label: string }[] = [
    { value: "", label: "Not specified" },
    { value: "founder", label: "Startup Founder" },
    { value: "developer", label: "Core Developer" },
    { value: "pm", label: "Technical PM" },
    { value: "investor", label: "VC / Investor" },
  ];

  async function save() {
    if (!displayName.trim()) { toast.error("Display name is required."); return; }
    if (githubUrl && !/^https?:\/\//.test(githubUrl.trim())) { toast.error("GitHub URL must start with https://"); return; }
    if (websiteUrl && !/^https?:\/\//.test(websiteUrl.trim())) { toast.error("Website URL must start with https://"); return; }
    setBusy(true);
    const { error } = await supabase.from("profiles").update({
      display_name: displayName.trim(),
      bio: bio.trim() || null,
      avatar_url: avatarUrl.trim() || null,
      company_name: companyName.trim() || null,
      role_type: (roleType || null) as any,
      github_url: githubUrl.trim() || null,
      portfolio_url: websiteUrl.trim() || null,
    }).eq("id", profile.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    await onSaved();
    toast.success("Profile updated.");
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Display Name">
          <input className="lux-field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} />
        </Field>
        <Field label="Role Type">
          <select className="lux-field" value={roleType} onChange={(e) => setRoleType(e.target.value)}>
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Company / Startup">
        <input className="lux-field" value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={80} />
      </Field>

      <Field label="Bio" hint="Max 200 characters.">
        <textarea rows={3} className="lux-field resize-y" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200} />
      </Field>

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
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="Avatar image URL (https://…)"
          />
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ─── Verification section ────────────────────────────────────────────────────
type VerificationRequestRow = {
  id: string;
  tier: "silver" | "gold";
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

function VerificationSection({ profile }: { profile: SelfProfile & { verification_tier: VerificationTier } }) {
  const { user } = useAuth();
  const [requests, setRequests] = useState<VerificationRequestRow[] | null>(null);
  const [silverGithub, setSilverGithub] = useState("");
  const [silverPortfolio, setSilverPortfolio] = useState("");
  const [goldStartup, setGoldStartup] = useState("");
  const [goldTraction, setGoldTraction] = useState("");
  const [busy, setBusy] = useState<"silver" | "gold" | null>(null);

  async function load() {
    if (!user) return;
    const { data } = await supabase
      .from("verification_requests")
      .select("id, tier, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setRequests((data ?? []) as VerificationRequestRow[]);
  }

  useEffect(() => { load(); }, [user]);

  function latestFor(tier: "silver" | "gold") {
    return requests?.find((r) => r.tier === tier) ?? null;
  }

  async function submit(tier: "silver" | "gold") {
    if (!user || !profile) return;
    const primary = tier === "silver" ? silverGithub.trim() : goldStartup.trim();
    const secondary = tier === "silver" ? silverPortfolio.trim() : goldTraction.trim();
    if (!primary) {
      toast.error(tier === "silver" ? "A GitHub link is required." : "A startup URL is required.");
      return;
    }
    setBusy(tier);
    const { error } = await supabase.from("verification_requests").insert({
      user_id: user.id,
      tier,
      link_primary: primary,
      link_secondary: secondary || null,
    });
    if (!error) {
      await supabase.from("profiles").update(
        tier === "silver"
          ? { github_url: primary, portfolio_url: secondary || null }
          : { startup_url: primary, traction_url: secondary || null },
      ).eq("id", user.id);
    }
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Submitted — your credentials are now under review.");
    await load();
  }

  return (
    <div className="space-y-4">
      {/* Silver */}
      <div className="glass-silver rounded-2xl p-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "rgba(148,163,184,0.12)" }}>
            <Github className="h-4 w-4" style={{ color: "#94a3b8" }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "#cbd5e1" }}>Silver — Recognized Builder</p>
            <p className="text-[11px]" style={{ color: "rgba(148,163,184,0.65)" }}>Verified contributor identity</p>
          </div>
          {(profile.verification_tier === "silver" || profile.verification_tier === "gold") && (
            <div className="ml-auto flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Verified
            </div>
          )}
        </div>
        <p className="mt-3 text-xs" style={{ color: "rgba(148,163,184,0.70)" }}>
          Verify with a public GitHub profile (and optional portfolio) that shows real shipped work.
        </p>
        <VerifStatusPill request={latestFor("silver")} />
        {profile.verification_tier !== "silver" && profile.verification_tier !== "gold" && (
          <div className="mt-4 space-y-2.5">
            <input className="lux-field" placeholder="https://github.com/yourhandle" value={silverGithub}
              onChange={(e) => setSilverGithub(e.target.value)} disabled={latestFor("silver")?.status === "pending"} />
            <input className="lux-field" placeholder="Portfolio URL (optional)" value={silverPortfolio}
              onChange={(e) => setSilverPortfolio(e.target.value)} disabled={latestFor("silver")?.status === "pending"} />
            <button
              type="button"
              onClick={() => submit("silver")}
              disabled={busy !== null || latestFor("silver")?.status === "pending"}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all disabled:opacity-40"
              style={{ border: "1px solid rgba(148,163,184,0.35)", color: "#94a3b8", background: "rgba(148,163,184,0.04)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(148,163,184,0.10)"; e.currentTarget.style.color = "#cbd5e1"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(148,163,184,0.04)"; e.currentTarget.style.color = "#94a3b8"; }}
            >
              {busy === "silver" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Apply for Silver
            </button>
          </div>
        )}
      </div>

      {/* Gold */}
      <div className="glass-gold rounded-2xl p-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "rgba(251,191,36,0.12)" }}>
            <Rocket className="h-4 w-4" style={{ color: "#fbbf24" }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "#fde68a" }}>Gold — Elite Founder</p>
            <p className="text-[11px]" style={{ color: "rgba(251,191,36,0.55)" }}>Maximum network prestige</p>
          </div>
          {profile.verification_tier === "gold" && (
            <div className="ml-auto flex items-center gap-1.5 text-[11px] font-medium text-amber-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Verified
            </div>
          )}
        </div>
        <p className="mt-3 text-xs" style={{ color: "rgba(251,191,36,0.60)" }}>
          Verify with your startup's public URL and a traction link (press, metrics, funding announcement).
        </p>
        <VerifStatusPill request={latestFor("gold")} />
        {profile.verification_tier !== "gold" && (
          <div className="mt-4 space-y-2.5">
            <input className="lux-field" placeholder="https://yourstartup.com" value={goldStartup}
              onChange={(e) => setGoldStartup(e.target.value)} disabled={latestFor("gold")?.status === "pending"} />
            <input className="lux-field" placeholder="Traction link (press / metrics / funding)" value={goldTraction}
              onChange={(e) => setGoldTraction(e.target.value)} disabled={latestFor("gold")?.status === "pending"} />
            <button
              type="button"
              onClick={() => submit("gold")}
              disabled={busy !== null || latestFor("gold")?.status === "pending"}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all disabled:opacity-40"
              style={{ border: "1px solid rgba(251,191,36,0.40)", color: "#fbbf24", background: "rgba(251,191,36,0.05)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(251,191,36,0.12)"; e.currentTarget.style.color = "#fde68a"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(251,191,36,0.05)"; e.currentTarget.style.color = "#fbbf24"; }}
            >
              {busy === "gold" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Apply for Gold
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function VerifStatusPill({ request }: { request: VerificationRequestRow | null }) {
  if (!request) return null;
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    pending: { bg: "rgba(251,191,36,0.10)", color: "#fbbf24", label: "Under Review" },
    approved: { bg: "rgba(34,197,94,0.10)", color: "#4ade80", label: "Approved" },
    rejected: { bg: "rgba(239,68,68,0.10)", color: "#f87171", label: "Not Approved" },
  };
  const s = styles[request.status] ?? styles.pending;
  return (
    <div
      className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label} · {timeAgo(request.created_at)}
    </div>
  );
}

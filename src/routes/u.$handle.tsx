import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MessageSquare, Github, Rocket, Settings, ShieldCheck, Loader2, Pencil, X, CheckCircle2, ExternalLink, FileCode2, Building2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { StatusCard, type Background } from "@/components/StatusCard";
import { VerificationBadge } from "@/components/VerificationBadge";
import { PitchModal, type PitchTarget } from "@/components/PitchModal";
import { useAuth } from "@/hooks/use-auth";
import type { RoleType, VerificationTier } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { startConversation } from "@/lib/messaging.functions";
import { submitVerificationApplication } from "@/lib/verification.functions";
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
      // Base columns — always present regardless of which migrations have run
      const { data: pf, error } = await supabase
        .from("profiles")
        .select("id, handle, display_name, avatar_url, bio, company_name, role_type, verification_tier, github_url, portfolio_url, startup_url, traction_url")
        .eq("handle", handle)
        .maybeSingle();
      if (cancelled) return;
      if (error || !pf) { setProfile(null); return; }

      // Optional columns added in later migrations — fail silently if absent
      let pitch_limit: number | null = null;
      let dm_cloaking_enabled = false;
      try {
        const { data: extra } = await supabase
          .from("profiles")
          .select("pitch_limit, dm_cloaking_enabled")
          .eq("id", pf.id)
          .maybeSingle();
        if (extra) {
          pitch_limit = (extra as any).pitch_limit ?? null;
          dm_cloaking_enabled = (extra as any).dm_cloaking_enabled ?? false;
        }
      } catch { /* columns may not exist in older schema — use defaults */ }

      if (cancelled) return;
      setProfile({ ...(pf as unknown as ProfileRow), pitch_limit, dm_cloaking_enabled });

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
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div
          className="grid h-14 w-14 shrink-0 overflow-hidden rounded-full text-xl font-semibold sm:h-16 sm:w-16"
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

        {/* Name / handle / meta — grows to fill available width */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="flex min-w-0 items-center gap-1.5 truncate text-lg font-semibold tracking-tight sm:text-xl">
                <span className="truncate">{profile.display_name}</span>
                <VerificationBadge tier={profile.verification_tier} size={16} />
              </h1>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                @{profile.handle}
                {profile.role_type ? ` · ${ROLE_LABEL[profile.role_type]}` : ""}
                {profile.company_name ? ` · ${profile.company_name}` : ""}
              </p>
            </div>

            {/* Action buttons — pinned to right, never overflow */}
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setEditMode((v) => !v)}
                className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                {editMode ? (
                  <><X className="h-3.5 w-3.5" /><span className="hidden sm:inline">Cancel</span></>
                ) : (
                  <><Pencil className="h-3.5 w-3.5" /><span className="hidden sm:inline">Edit</span></>
                )}
              </button>
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

          {!editMode && profile.bio && (
            <p className="mt-1.5 text-sm text-foreground/80 break-words">{profile.bio}</p>
          )}
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
  const doSubmit = useServerFn(submitVerificationApplication);
  const [activeTab, setActiveTab] = useState<"silver" | "gold">("silver");
  const [requests, setRequests] = useState<VerificationRequestRow[] | null>(null);

  // ── Silver fields ──────────────────────────────────────────────────────────
  const [sGithub, setSGithub] = useState("");
  const [sContract, setSContract] = useState("");
  const [sLiveUrl, setSLiveUrl] = useState("");
  const [sShipDesc, setSShipDesc] = useState("");

  // ── Gold fields ────────────────────────────────────────────────────────────
  const [gFundName, setGFundName] = useState("");
  const [gPortfolio, setGPortfolio] = useState("");
  const [gLinkedin, setGLinkedin] = useState("");
  const [gInviteCode, setGInviteCode] = useState("");

  const [busy, setBusy] = useState(false);

  async function loadRequests() {
    if (!user) return;
    const { data } = await supabase
      .from("verification_requests")
      .select("id, tier, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setRequests((data ?? []) as VerificationRequestRow[]);
  }

  useEffect(() => { loadRequests(); }, [user]);

  function latestFor(tier: "silver" | "gold") {
    return requests?.find((r) => r.tier === tier) ?? null;
  }

  async function handleSubmit() {
    if (!user) return;
    setBusy(true);
    try {
      await doSubmit({
        data: activeTab === "silver"
          ? {
              tier: "silver" as const,
              github_url: sGithub.trim(),
              deployed_contract_address: sContract.trim(),
              live_project_url: sLiveUrl.trim(),
              recent_ship_desc: sShipDesc.trim(),
            }
          : {
              tier: "gold" as const,
              fund_or_company_name: gFundName.trim(),
              portfolio_url: gPortfolio.trim(),
              linkedin_or_x_url: gLinkedin.trim(),
              invite_code: gInviteCode.trim(),
            },
      });
      toast.success("Application submitted — your credentials are now under review.");
      await loadRequests();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submission failed.");
    } finally {
      setBusy(false);
    }
  }

  // Resolved states for each tier
  const silverLatest = latestFor("silver");
  const goldLatest   = latestFor("gold");
  const isSilverVerified = profile.verification_tier === "silver" || profile.verification_tier === "gold";
  const isGoldVerified   = profile.verification_tier === "gold";

  const activeLatest   = activeTab === "silver" ? silverLatest : goldLatest;
  const activeVerified = activeTab === "silver" ? isSilverVerified : isGoldVerified;
  const isPending      = activeLatest?.status === "pending";
  const isRejected     = activeLatest?.status === "rejected";
  const canApply       = !activeVerified && !isPending;

  // Tier styles
  const silverStyle = {
    card: "glass-silver",
    accent: "#94a3b8",
    accentBright: "#cbd5e1",
    iconBg: "rgba(148,163,184,0.12)",
    title: "#cbd5e1",
    subtitle: "rgba(148,163,184,0.65)",
    desc: "rgba(148,163,184,0.70)",
    btnBorder: "rgba(148,163,184,0.35)",
    btnBg: "rgba(148,163,184,0.04)",
    btnHoverBg: "rgba(148,163,184,0.12)",
  };
  const goldStyle = {
    card: "glass-gold",
    accent: "#fbbf24",
    accentBright: "#fde68a",
    iconBg: "rgba(251,191,36,0.12)",
    title: "#fde68a",
    subtitle: "rgba(251,191,36,0.55)",
    desc: "rgba(251,191,36,0.60)",
    btnBorder: "rgba(251,191,36,0.40)",
    btnBg: "rgba(251,191,36,0.04)",
    btnHoverBg: "rgba(251,191,36,0.12)",
  };
  const ts = activeTab === "silver" ? silverStyle : goldStyle;

  return (
    <div className="space-y-4">
      {/* ── Tab selector ────────────────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-xl border border-border/50 bg-secondary/10 p-1">
        <button
          type="button"
          onClick={() => setActiveTab("silver")}
          className={"flex flex-1 items-center justify-center gap-2 rounded-[9px] py-2 text-[13px] font-medium transition-all " +
            (activeTab === "silver"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground/80")}
        >
          <Github className="h-3.5 w-3.5" style={activeTab === "silver" ? { color: "#94a3b8" } : {}} />
          Silver · Builder
          {isSilverVerified && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("gold")}
          className={"flex flex-1 items-center justify-center gap-2 rounded-[9px] py-2 text-[13px] font-medium transition-all " +
            (activeTab === "gold"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground/80")}
        >
          <Users className="h-3.5 w-3.5" style={activeTab === "gold" ? { color: "#fbbf24" } : {}} />
          Gold · Investor
          {isGoldVerified && <CheckCircle2 className="h-3 w-3 text-amber-400" />}
        </button>
      </div>

      {/* ── Active track card ───────────────────────────────────────────────── */}
      <div className={`${ts.card} rounded-2xl p-5 space-y-4`}>

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: ts.iconBg }}>
              {activeTab === "silver"
                ? <Github className="h-4 w-4" style={{ color: ts.accent }} />
                : <Building2 className="h-4 w-4" style={{ color: ts.accent }} />}
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: ts.title }}>
                {activeTab === "silver" ? "Silver — Recognized Builder" : "Gold — Verified Investor"}
              </p>
              <p className="text-[11px]" style={{ color: ts.subtitle }}>
                {activeTab === "silver" ? "For active builders who ship" : "For fund managers & angels"}
              </p>
            </div>
          </div>
          {activeVerified && (
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Verified
            </div>
          )}
        </div>

        {/* Description */}
        <p className="text-xs" style={{ color: ts.desc }}>
          {activeTab === "silver"
            ? "Provide your GitHub profile and at least one live project so we can verify you're an active builder."
            : "Provide your fund or company name and portfolio. An invite code from an existing Gold member accelerates review."}
        </p>

        {/* Status pill */}
        {activeLatest && (
          <div
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium"
            style={
              activeLatest.status === "pending"
                ? { background: "rgba(251,191,36,0.10)", color: "#fbbf24" }
                : activeLatest.status === "approved"
                  ? { background: "rgba(34,197,94,0.10)", color: "#4ade80" }
                  : { background: "rgba(239,68,68,0.10)", color: "#f87171" }
            }
          >
            {activeLatest.status === "pending" && "⏳ Under Review"}
            {activeLatest.status === "approved" && "✓ Approved"}
            {activeLatest.status === "rejected" && "✕ Not Approved — you can reapply below"}
            <span className="opacity-60">· {timeAgo(activeLatest.created_at)}</span>
          </div>
        )}

        {/* ── Silver form ────────────────────────────────────────────────────── */}
        {canApply && activeTab === "silver" && (
          <div className="space-y-2.5">
            <div className="space-y-1">
              <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: ts.subtitle }}>
                GitHub Profile URL <span style={{ color: ts.accent }}>*</span>
              </label>
              <div className="relative">
                <Github className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: ts.accent }} />
                <input
                  className="lux-field pl-8"
                  placeholder="https://github.com/yourhandle"
                  value={sGithub}
                  onChange={(e) => setSGithub(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: ts.subtitle }}>
                Live DApp / Project URL
              </label>
              <div className="relative">
                <ExternalLink className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: ts.accent }} />
                <input
                  className="lux-field pl-8"
                  placeholder="https://yourproject.xyz"
                  value={sLiveUrl}
                  onChange={(e) => setSLiveUrl(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: ts.subtitle }}>
                Deployed Contract Address
              </label>
              <div className="relative">
                <FileCode2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: ts.accent }} />
                <input
                  className="lux-field pl-8 font-mono text-xs"
                  placeholder="0x…"
                  value={sContract}
                  onChange={(e) => setSContract(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider" style={{ color: ts.subtitle }}>
                <span>What did you ship this week?</span>
                <span style={{ color: sShipDesc.length > 90 ? "#f87171" : ts.subtitle }}>{sShipDesc.length}/100</span>
              </label>
              <textarea
                className="lux-field resize-none"
                rows={2}
                placeholder="One sentence — the more specific the better."
                maxLength={100}
                value={sShipDesc}
                onChange={(e) => setSShipDesc(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* ── Gold form ──────────────────────────────────────────────────────── */}
        {canApply && activeTab === "gold" && (
          <div className="space-y-2.5">
            <div className="space-y-1">
              <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: ts.subtitle }}>
                Fund or Company Name <span style={{ color: ts.accent }}>*</span>
              </label>
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: ts.accent }} />
                <input
                  className="lux-field pl-8"
                  placeholder="Acme Ventures"
                  value={gFundName}
                  onChange={(e) => setGFundName(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: ts.subtitle }}>
                Portfolio / Fund Website
              </label>
              <div className="relative">
                <ExternalLink className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: ts.accent }} />
                <input
                  className="lux-field pl-8"
                  placeholder="https://acmeventures.com"
                  value={gPortfolio}
                  onChange={(e) => setGPortfolio(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: ts.subtitle }}>
                LinkedIn or X Profile
              </label>
              <div className="relative">
                <ExternalLink className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: ts.accent }} />
                <input
                  className="lux-field pl-8"
                  placeholder="https://linkedin.com/in/yourname"
                  value={gLinkedin}
                  onChange={(e) => setGLinkedin(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: ts.subtitle }}>
                Invite Code <span className="normal-case" style={{ color: ts.subtitle }}>(optional — speeds up review)</span>
              </label>
              <input
                className="lux-field font-mono tracking-widest text-xs"
                placeholder="LEDGER-XXXX"
                value={gInviteCode}
                onChange={(e) => setGInviteCode(e.target.value.toUpperCase())}
              />
            </div>
          </div>
        )}

        {/* Already verified message */}
        {activeVerified && (
          <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)", color: "#4ade80" }}>
            You already hold {activeTab === "silver" ? "Silver (or higher)" : "Gold"} verification — no action needed.
          </div>
        )}

        {/* Submit button */}
        {canApply && (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all disabled:opacity-40"
            style={{ border: `1px solid ${ts.btnBorder}`, color: ts.accent, background: ts.btnBg }}
            onMouseEnter={(e) => { e.currentTarget.style.background = ts.btnHoverBg; e.currentTarget.style.color = ts.accentBright; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = ts.btnBg; e.currentTarget.style.color = ts.accent; }}
          >
            {busy
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <ShieldCheck className="h-4 w-4" />}
            {isRejected ? "Reapply" : `Apply for ${activeTab === "silver" ? "Silver Builder" : "Gold Investor"}`}
          </button>
        )}
      </div>
    </div>
  );
}

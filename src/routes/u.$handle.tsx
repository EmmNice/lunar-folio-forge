import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MessageSquare, Github, Rocket, Settings, ShieldCheck, Loader2 } from "lucide-react";
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

// ─── Shared lux tab bar ───────────────────────────────────────────────────────
type SelfTab = "posts" | "edit" | "verification";

function TabBar({
  active,
  onChange,
}: { active: SelfTab; onChange: (t: SelfTab) => void }) {
  const tabs: { id: SelfTab; label: string }[] = [
    { id: "posts", label: "My Posts" },
    { id: "edit", label: "Edit Profile" },
    { id: "verification", label: "Verification" },
  ];
  return (
    <div
      className="flex gap-0 border-b"
      style={{ borderColor: "rgba(255,255,255,0.07)" }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={
            "px-4 py-2.5 text-sm font-medium transition-colors " +
            (active === t.id
              ? "border-b-2 text-foreground"
              : "text-muted-foreground hover:text-foreground")
          }
          style={active === t.id ? { borderBottomColor: "#F5F5F6" } : {}}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────
function ProfilePage() {
  const { handle } = Route.useParams();
  const search = useSearch({ from: "/u/$handle" });
  const { user, profile: me, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const start = useServerFn(startConversation);

  const [profile, setProfile] = useState<ProfileRow | null | undefined>(undefined);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [busyMsg, setBusyMsg] = useState(false);
  const [showPitchModal, setShowPitchModal] = useState(false);
  const [selfTab, setSelfTab] = useState<SelfTab>(search.tab ?? "posts");

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

  // Sync tab param from URL
  useEffect(() => {
    if (search.tab) setSelfTab(search.tab);
  }, [search.tab]);

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

  // Loading / not-found states
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

  // ── SELF VIEW — Identity Hub ───────────────────────────────────────────────
  if (isSelf && me) {
    return (
      <div className="min-h-screen pb-16 sm:pb-0">
        <AppHeader />
        <main className="mx-auto max-w-2xl px-4 pt-10 pb-28 sm:px-6">
          {/* Profile hero */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div
                className="grid h-16 w-16 shrink-0 overflow-hidden rounded-full text-xl font-semibold"
                style={{ border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.05)" }}
              >
                {me.avatar_url ? (
                  <img src={me.avatar_url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="grid h-full w-full place-items-center">
                    {me.display_name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div>
                <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                  {me.display_name}
                  <VerificationBadge tier={me.verification_tier} size={18} />
                </h1>
                <p className="text-sm text-muted-foreground">
                  @{me.handle}
                  {me.company_name ? ` · ${me.company_name}` : ""}
                </p>
                {me.bio && (
                  <p className="mt-1 text-sm text-foreground/80">{me.bio}</p>
                )}
              </div>
            </div>

            {/* Gear → Account Settings */}
            <Link
              to="/settings"
              aria-label="Account Settings"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:text-foreground"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <Settings className="h-4 w-4" />
            </Link>
          </div>

          {/* Tab bar */}
          <div className="mt-8">
            <TabBar active={selfTab} onChange={setSelfTab} />
          </div>

          {/* Tab content */}
          <div className="mt-6">
            {selfTab === "posts" && <MyPostsTab posts={posts} profile={profile} />}
            {selfTab === "edit" && <EditProfileTab onSaved={refreshProfile} />}
            {selfTab === "verification" && <VerificationTab />}
          </div>
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
            {/* Connect links */}
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

            {/* Pitch button (Silver/Gold viewer → Gold profile) */}
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

            {/* Message button */}
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

// ─── TAB 1: My Posts ─────────────────────────────────────────────────────────
function MyPostsTab({ posts, profile }: { posts: PostRow[]; profile: ProfileRow }) {
  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-2xl py-12 text-center"
        style={{ border: "1px dashed rgba(255,255,255,0.10)" }}>
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
    );
  }
  return (
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
  );
}

// ─── TAB 2: Edit Profile ──────────────────────────────────────────────────────
function EditProfileTab({ onSaved }: { onSaved: () => Promise<void> }) {
  const { profile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [companyName, setCompanyName] = useState(profile?.company_name ?? "");
  const [roleType, setRoleType] = useState<string>(profile?.role_type ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? "");
  const [githubUrl, setGithubUrl] = useState(profile?.github_url ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(profile?.portfolio_url ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name);
    setBio(profile.bio ?? "");
    setCompanyName(profile.company_name ?? "");
    setRoleType(profile.role_type ?? "");
    setAvatarUrl(profile.avatar_url ?? "");
    setGithubUrl(profile.github_url ?? "");
    setWebsiteUrl(profile.portfolio_url ?? "");
  }, [profile?.id]);

  const ROLE_OPTIONS: { value: RoleType | ""; label: string }[] = [
    { value: "", label: "Not specified" },
    { value: "founder", label: "Startup Founder" },
    { value: "developer", label: "Core Developer" },
    { value: "pm", label: "Technical PM" },
    { value: "investor", label: "VC / Investor" },
  ];

  async function save() {
    if (!profile) return;
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
    <div className="space-y-5">
      <Field label="Display Name">
        <input className="lux-field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} />
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

      <Field label="Role Type">
        <select
          className="lux-field"
          value={roleType}
          onChange={(e) => setRoleType(e.target.value)}
        >
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>

      <Field label="Company / Startup">
        <input className="lux-field" value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={80} />
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
        Save Profile
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

// ─── TAB 3: Verification ──────────────────────────────────────────────────────
type VerificationRequestRow = {
  id: string;
  tier: "silver" | "gold";
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

function VerificationTab() {
  const { profile, user } = useAuth();
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
    <div className="space-y-5">
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
        </div>
        <p className="mt-3 text-xs" style={{ color: "rgba(148,163,184,0.70)" }}>
          Verify with a public GitHub profile (and optional portfolio) that shows real shipped work.
        </p>
        <VerifStatusPill request={latestFor("silver")} />
        {profile?.verification_tier !== "silver" && profile?.verification_tier !== "gold" && (
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
        </div>
        <p className="mt-3 text-xs" style={{ color: "rgba(251,191,36,0.60)" }}>
          Verify with your startup's public URL and a traction link (press, metrics, funding announcement).
        </p>
        <VerifStatusPill request={latestFor("gold")} />
        {profile?.verification_tier !== "gold" && (
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
  const style =
    request.status === "approved" ? "text-emerald-400 border-emerald-400/40"
    : request.status === "rejected" ? "text-red-400 border-red-400/40"
    : "text-amber-400 border-amber-400/40";
  const label =
    request.status === "approved" ? "Verified"
    : request.status === "rejected" ? "Not approved"
    : "Under Review";
  return (
    <span className={"mt-2 inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium " + style}>
      {label}
    </span>
  );
}

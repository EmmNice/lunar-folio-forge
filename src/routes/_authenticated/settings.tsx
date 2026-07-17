import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Github, Rocket, Inbox, EyeOff } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { VerificationBadge } from "@/components/VerificationBadge";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { acceptPitch } from "@/lib/pitch.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Studio Settings · The Ledger" }] }),
  component: SettingsPage,
});

type Tab = "profile" | "verification" | "pitches" | "privacy";

function SettingsPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>("profile");

  const tabs: { id: Tab; label: string; goldOnly?: boolean }[] = [
    { id: "profile", label: "Profile" },
    { id: "verification", label: "Verification" },
    { id: "pitches", label: "Inbound Pitches", goldOnly: true },
    { id: "privacy", label: "Privacy", goldOnly: true },
  ];

  const visibleTabs = tabs.filter((t) => !t.goldOnly || profile?.verification_tier === "gold");

  return (
    <div className="min-h-screen pb-16 sm:pb-0">
      <AppHeader />
      <main className="mx-auto max-w-lg px-4 pt-10 pb-24 sm:px-6">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
          The Ledger
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Studio Settings</h1>

        <div className="mt-6 flex gap-1 border-b border-border/60">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={
                "px-3 py-2 text-sm font-medium transition-colors " +
                (tab === t.id
                  ? "border-b-2 border-foreground text-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-8">
          {tab === "profile" && <ProfileTab />}
          {tab === "verification" && <VerificationTab />}
          {tab === "pitches" && profile?.verification_tier === "gold" && <PitchesTab />}
          {tab === "privacy" && profile?.verification_tier === "gold" && <PrivacyTab />}
        </div>
      </main>
    </div>
  );
}

function ProfileTab() {
  const { profile, refreshProfile } = useAuth();
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setHandle(profile.handle);
    setDisplayName(profile.display_name);
    setBio(profile.bio ?? "");
    setAvatarUrl(profile.avatar_url ?? "");
    setCompanyName(profile.company_name ?? "");
    setGithubUrl(profile.github_url ?? "");
    setWebsiteUrl(profile.portfolio_url ?? "");
  }, [profile]);

  async function save() {
    if (!profile) return;
    if (!/^[a-z0-9_]{2,20}$/.test(handle)) {
      toast.error("Handle must be 2–20 chars: lowercase letters, numbers, or _.");
      return;
    }
    if (!displayName.trim()) { toast.error("Display name is required."); return; }
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
        handle,
        display_name: displayName.trim(),
        bio: bio.trim() || null,
        avatar_url: avatarUrl.trim() || null,
        company_name: companyName.trim() || null,
        github_url: githubUrl.trim() || null,
        portfolio_url: websiteUrl.trim() || null,
      })
      .eq("id", profile.id);
    setBusy(false);
    if (error) {
      toast.error(error.message.includes("profiles_handle_key") ? "That handle is taken." : error.message);
      return;
    }
    await refreshProfile();
    toast.success("Profile updated.");
  }

  const field =
    "w-full rounded-md border border-border bg-secondary/40 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-foreground/40";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Verification status:</span>
        <VerificationBadge tier={profile?.verification_tier} size={16} />
        <span className="text-sm font-medium capitalize">{profile?.verification_tier ?? "none"}</span>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs uppercase tracking-wider text-muted-foreground">Handle</label>
        <input className={field} value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} />
        <p className="text-xs text-muted-foreground">Lowercase letters, numbers, underscore. 2–20 chars.</p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs uppercase tracking-wider text-muted-foreground">Display name</label>
        <input className={field} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs uppercase tracking-wider text-muted-foreground">Company / startup</label>
        <input className={field} value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={80} />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs uppercase tracking-wider text-muted-foreground">Bio</label>
        <textarea rows={3} className={field + " resize-y"} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200} />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs uppercase tracking-wider text-muted-foreground">Avatar URL</label>
        <input className={field} value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
        <p className="text-xs text-muted-foreground">Paste a public image URL to use as your avatar.</p>
      </div>
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          <Github className="h-3.5 w-3.5" /> GitHub URL
        </label>
        <input
          className={field}
          value={githubUrl}
          onChange={(e) => setGithubUrl(e.target.value)}
          placeholder="https://github.com/yourhandle"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs uppercase tracking-wider text-muted-foreground">Website / Portfolio</label>
        <input
          className={field}
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          placeholder="https://yoursite.com"
        />
      </div>
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="w-full rounded-md bg-foreground px-4 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Saving…" : "Save Profile"}
      </button>
    </div>
  );
}

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
      await supabase
        .from("profiles")
        .update(
          tier === "silver"
            ? { github_url: primary, portfolio_url: secondary || null }
            : { startup_url: primary, traction_url: secondary || null },
        )
        .eq("id", user.id);
    }
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Submitted — your credentials are now under review.");
    await load();
  }

  const field =
    "w-full rounded-md border border-border bg-secondary/40 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-foreground/40";

  return (
    <div className="space-y-6">
      {/* ── Silver card — glassmorphism ── */}
      <div
        className="glass-silver rounded-2xl p-5"
      >
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
        <StatusPill request={latestFor("silver")} />
        {profile?.verification_tier !== "silver" && profile?.verification_tier !== "gold" ? (
          <div className="mt-4 space-y-2.5">
            <input
              className="lux-field"
              placeholder="https://github.com/yourhandle"
              value={silverGithub}
              onChange={(e) => setSilverGithub(e.target.value)}
              disabled={latestFor("silver")?.status === "pending"}
            />
            <input
              className="lux-field"
              placeholder="Portfolio URL (optional)"
              value={silverPortfolio}
              onChange={(e) => setSilverPortfolio(e.target.value)}
              disabled={latestFor("silver")?.status === "pending"}
            />
            {/* Silver CTA — brushed-metal outline */}
            <button
              type="button"
              onClick={() => submit("silver")}
              disabled={busy !== null || latestFor("silver")?.status === "pending"}
              className="group inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all disabled:opacity-40"
              style={{
                border: "1px solid rgba(148,163,184,0.35)",
                color: "#94a3b8",
                background: "rgba(148,163,184,0.04)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(148,163,184,0.10)";
                e.currentTarget.style.borderColor = "rgba(148,163,184,0.55)";
                e.currentTarget.style.color = "#cbd5e1";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(148,163,184,0.04)";
                e.currentTarget.style.borderColor = "rgba(148,163,184,0.35)";
                e.currentTarget.style.color = "#94a3b8";
              }}
            >
              {busy === "silver" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Apply for Silver
            </button>
          </div>
        ) : null}
      </div>

      {/* ── Gold card — glassmorphism ── */}
      <div
        className="glass-gold rounded-2xl p-5"
      >
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
        <StatusPill request={latestFor("gold")} />
        {profile?.verification_tier !== "gold" ? (
          <div className="mt-4 space-y-2.5">
            <input
              className="lux-field"
              placeholder="https://yourstartup.com"
              value={goldStartup}
              onChange={(e) => setGoldStartup(e.target.value)}
              disabled={latestFor("gold")?.status === "pending"}
            />
            <input
              className="lux-field"
              placeholder="Traction link (press / metrics / funding)"
              value={goldTraction}
              onChange={(e) => setGoldTraction(e.target.value)}
              disabled={latestFor("gold")?.status === "pending"}
            />
            {/* Gold CTA — luminous champagne-gold outline */}
            <button
              type="button"
              onClick={() => submit("gold")}
              disabled={busy !== null || latestFor("gold")?.status === "pending"}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all disabled:opacity-40"
              style={{
                border: "1px solid rgba(251,191,36,0.40)",
                color: "#fbbf24",
                background: "rgba(251,191,36,0.05)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(251,191,36,0.12)";
                e.currentTarget.style.borderColor = "rgba(251,191,36,0.65)";
                e.currentTarget.style.color = "#fde68a";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(251,191,36,0.05)";
                e.currentTarget.style.borderColor = "rgba(251,191,36,0.40)";
                e.currentTarget.style.color = "#fbbf24";
              }}
            >
              {busy === "gold" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Apply for Gold
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatusPill({ request }: { request: VerificationRequestRow | null }) {
  if (!request) return null;
  const style =
    request.status === "approved"
      ? "text-emerald-400 border-emerald-400/40"
      : request.status === "rejected"
        ? "text-red-400 border-red-400/40"
        : "text-amber-400 border-amber-400/40";
  const label =
    request.status === "approved"
      ? "Verified"
      : request.status === "rejected"
        ? "Not approved"
        : "Credentials Under Review";
  return (
    <span className={"mt-2 inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium " + style}>
      {label}
    </span>
  );
}

function PrivacyTab() {
  const { profile, user, refreshProfile } = useAuth();
  const [cloaking, setCloaking] = useState<boolean>(profile?.dm_cloaking_enabled ?? false);
  const [busy, setBusy] = useState(false);

  async function save(next: boolean) {
    if (!user) return;
    setCloaking(next);
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ dm_cloaking_enabled: next } as any)
      .eq("id", user.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      setCloaking(!next);
      return;
    }
    await refreshProfile();
    toast.success(next ? "DM Cloaking enabled." : "DM Cloaking disabled.");
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-amber-500/20 bg-card/40 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <EyeOff className="h-4 w-4 text-amber-400" /> DM Cloaking
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          When enabled, unverified users cannot see your Connect or Message buttons on your public
          profile. Only other Silver &amp; Gold members can reach you directly.
        </p>

        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-secondary/20 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">Hide contact buttons from unverified visitors</p>
            <p className="text-xs text-muted-foreground">Silver &amp; Gold members can still message and connect.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={cloaking}
            disabled={busy}
            onClick={() => save(!cloaking)}
            className={
              "relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-60 " +
              (cloaking ? "border-amber-500 bg-amber-500" : "border-border bg-border/30")
            }
          >
            <span
              className={
                "absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform " +
                (cloaking ? "translate-x-5" : "translate-x-0.5")
              }
            />
          </button>
        </div>

        {cloaking && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-400/80">
            <EyeOff className="h-3.5 w-3.5" />
            DM Cloaking is active — unverified visitors cannot see your contact options.
          </p>
        )}
      </div>
    </div>
  );
}

const LIMIT_OPTIONS = [
  { label: "Do Not Disturb (block all)", value: 0 },
  { label: "3 per week (minimum)", value: 3 },
  { label: "5 per week", value: 5 },
  { label: "10 per week", value: 10 },
  { label: "20 per week", value: 20 },
  { label: "Unlimited", value: null as number | null },
];

type PitchRow = {
  id: string;
  company_name: string;
  pitch: string;
  deck_url: string | null;
  status: string;
  created_at: string;
  sender: {
    id: string;
    handle: string;
    display_name: string;
    avatar_url: string | null;
    verification_tier: string;
  } | null;
};

function PitchesTab() {
  const { profile, user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const accept = useServerFn(acceptPitch);
  const [pitchLimit, setPitchLimit] = useState<number | null>(profile?.pitch_limit ?? null);
  const [busy, setBusy] = useState(false);
  const [pitches, setPitches] = useState<PitchRow[] | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    loadPitches();
  }, [user]);

  async function loadPitches() {
    if (!user) return;
    const { data } = await supabase
      .from("pitches")
      .select(
        "id, company_name, pitch, deck_url, status, created_at, sender:profiles!pitches_sender_id_fkey(id, handle, display_name, avatar_url, verification_tier)",
      )
      .eq("recipient_id", user.id)
      .in("status", ["pending"])
      .order("created_at", { ascending: false })
      .limit(50);
    setPitches((data ?? []) as unknown as PitchRow[]);
  }

  async function saveLimit() {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ pitch_limit: pitchLimit } as any)
      .eq("id", user.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    await refreshProfile();
    toast.success("Pitch limit updated.");
  }

  async function handleAccept(p: PitchRow) {
    if (!p.sender) return;
    setActionBusy(p.id + ":accept");
    try {
      const res = await accept({ data: { pitchId: p.id, senderId: p.sender.id } });
      setPitches((prev) => prev?.filter((x) => x.id !== p.id) ?? null);
      toast.success("Pitch accepted — opening DM thread.");
      navigate({ to: "/messages/$id", params: { id: res.conversationId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to accept pitch.");
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDecline(pitchId: string) {
    setActionBusy(pitchId + ":decline");
    const { error } = await supabase
      .from("pitches")
      .update({ status: "declined" } as any)
      .eq("id", pitchId);
    setActionBusy(null);
    if (error) { toast.error(error.message); return; }
    // Silently remove from list — no notification to sender
    setPitches((prev) => prev?.filter((x) => x.id !== pitchId) ?? null);
  }

  return (
    <div className="space-y-8">
      {/* Limit settings */}
      <div className="rounded-2xl border border-amber-500/20 bg-card/40 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Inbox className="h-4 w-4 text-amber-400" /> Inbound Pitch Limit
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Control how many new pitch requests you receive per week. Set 0 to pause all incoming pitches.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {LIMIT_OPTIONS.map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => setPitchLimit(opt.value)}
              className={
                "rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors " +
                (pitchLimit === opt.value
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                  : "border-border text-muted-foreground hover:text-foreground")
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={saveLimit}
          disabled={busy}
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save limit
        </button>
      </div>

      {/* Inbound pitches inbox */}
      <div>
        <h3 className="mb-1 text-sm font-semibold">Inbound Pitches</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Accept to open a DM thread with the founder. Decline silently archives the request.
        </p>
        {pitches === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : pitches.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            No pending pitches.
          </div>
        ) : (
          <div className="space-y-3">
            {pitches.map((p) => (
              <div key={p.id} className="rounded-2xl border border-border/60 bg-card/40 p-4">
                <div className="flex items-start gap-3">
                  {/* Sender avatar */}
                  <div className="grid h-9 w-9 shrink-0 overflow-hidden rounded-full border border-border bg-secondary/50 text-xs font-semibold">
                    {p.sender?.avatar_url ? (
                      <img src={p.sender.avatar_url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="grid h-full w-full place-items-center">
                        {(p.sender?.display_name ?? "?").charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      {p.sender?.display_name ?? "Unknown"}
                      <VerificationBadge tier={(p.sender?.verification_tier as any) ?? "none"} size={12} />
                      <span className="text-xs text-muted-foreground">@{p.sender?.handle}</span>
                    </div>
                    <p className="mt-0.5 text-xs font-semibold text-amber-400/80">{p.company_name}</p>
                    <p className="mt-2 text-sm leading-relaxed text-foreground/90">{p.pitch}</p>
                    {p.deck_url && (
                      <a
                        href={p.deck_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-2 inline-block text-xs text-amber-400 underline underline-offset-4 hover:text-amber-300"
                      >
                        View Deck / Demo →
                      </a>
                    )}
                  </div>
                </div>

                {/* Accept / Decline actions */}
                <div className="mt-3 flex gap-2 border-t border-border/50 pt-3">
                  <button
                    type="button"
                    onClick={() => handleAccept(p)}
                    disabled={actionBusy !== null}
                    className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-xs font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {actionBusy === p.id + ":accept" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDecline(p.id)}
                    disabled={actionBusy !== null}
                    className="rounded-md border border-border px-4 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    {actionBusy === p.id + ":decline" ? (
                      <Loader2 className="inline h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Decline"
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

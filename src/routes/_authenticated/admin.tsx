import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ShieldCheck, ShieldOff, Loader2, Users, FileText,
  Github, ExternalLink, Building2, CheckCircle2, XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { VerificationBadge } from "@/components/VerificationBadge";
import { useAuth } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { reviewApplication } from "@/lib/verification.functions";
import { timeAgo } from "@/lib/time";
import type { VerificationTier } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin Panel · The Ledger" }] }),
  component: AdminPage,
});

// ── Types ─────────────────────────────────────────────────────────────────────
type ProfileRow = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  verification_tier: VerificationTier;
  company_name: string | null;
  role_type: string | null;
  onboarding_completed: boolean;
  created_at: string;
};

type ApplicationRow = {
  id: string;
  tier: "silver" | "gold";
  status: "pending" | "approved" | "rejected";
  created_at: string;
  github_url: string | null;
  deployed_contract_address: string | null;
  live_project_url: string | null;
  recent_ship_desc: string | null;
  fund_or_company_name: string | null;
  portfolio_url: string | null;
  linkedin_or_x_url: string | null;
  invite_code: string | null;
  link_primary: string | null;
  link_secondary: string | null;
  profiles: {
    id: string;
    handle: string;
    display_name: string;
    avatar_url: string | null;
    company_name: string | null;
  } | null;
};

// ── Page ─────────────────────────────────────────────────────────────────────
/** True if the current user's UUID is listed in VITE_ADMIN_IDS env var */
function checkEnvAdmin(userId: string): boolean {
  const ids = (import.meta.env.VITE_ADMIN_IDS ?? "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);
  return ids.includes(userId);
}

function AdminPage() {
  const { isAdmin: dbAdmin, loading, user } = useAuth();
  const isAdmin = dbAdmin || (user ? checkEnvAdmin(user.id) : false);
  const navigate = useNavigate();
  const doReview = useServerFn(reviewApplication);

  const [adminTab, setAdminTab] = useState<"members" | "applications">("applications");
  const [search, setSearch] = useState("");

  // Members
  const [profiles, setProfiles] = useState<ProfileRow[] | null>(null);
  const [memberBusy, setMemberBusy] = useState<Record<string, boolean>>({});

  // Applications
  const [applications, setApplications] = useState<ApplicationRow[] | null>(null);
  const [reviewBusy, setReviewBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (loading) return;
    if (!isAdmin) navigate({ to: "/feed", replace: true });
  }, [loading, isAdmin, navigate]);

  // ── Load members ────────────────────────────────────────────────────────────
  async function loadProfiles() {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, handle, display_name, avatar_url, verification_tier, company_name, role_type, onboarding_completed, created_at")
      .order("created_at", { ascending: false });
    if (error) { toast.error("Failed to load profiles."); return; }
    setProfiles((data ?? []) as ProfileRow[]);
  }

  // ── Load pending applications ───────────────────────────────────────────────
  async function loadApplications() {
    const { data, error } = await supabase
      .from("verification_requests")
      .select(`
        id, tier, status, created_at,
        github_url, deployed_contract_address, live_project_url, recent_ship_desc,
        fund_or_company_name, portfolio_url, linkedin_or_x_url, invite_code,
        link_primary, link_secondary,
        profiles!verification_requests_user_id_fkey(id, handle, display_name, avatar_url, company_name)
      `)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) { toast.error("Failed to load applications."); return; }
    setApplications((data ?? []) as unknown as ApplicationRow[]);
  }

  useEffect(() => {
    if (!isAdmin) return;
    loadProfiles();
    loadApplications();
  }, [isAdmin]);

  // ── Member tier change ──────────────────────────────────────────────────────
  async function setTier(profileId: string, tier: VerificationTier) {
    setMemberBusy((b) => ({ ...b, [profileId]: true }));
    const { error } = await supabase.from("profiles").update({ verification_tier: tier }).eq("id", profileId);
    setMemberBusy((b) => ({ ...b, [profileId]: false }));
    if (error) { toast.error(error.message); return; }
    toast.success(tier === "none" ? "Verification revoked." : `${tier.charAt(0).toUpperCase() + tier.slice(1)} badge granted.`);
    setProfiles((prev) => prev?.map((p) => (p.id === profileId ? { ...p, verification_tier: tier } : p)) ?? null);
  }

  // ── Review application (approve / reject) ──────────────────────────────────
  async function review(appId: string, action: "approve" | "reject") {
    setReviewBusy((b) => ({ ...b, [appId]: true }));
    try {
      await doReview({ data: { applicationId: appId, action } });
      toast.success(action === "approve" ? "Application approved — badge granted & email sent." : "Application rejected — user notified by email.");
      // Remove from pending list
      setApplications((prev) => prev?.filter((a) => a.id !== appId) ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Review failed.");
    } finally {
      setReviewBusy((b) => ({ ...b, [appId]: false }));
    }
  }

  if (loading || !isAdmin) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  const filteredProfiles = (profiles ?? []).filter(
    (p) =>
      !search ||
      p.handle.toLowerCase().includes(search.toLowerCase()) ||
      p.display_name.toLowerCase().includes(search.toLowerCase()) ||
      (p.company_name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const silverApps = (applications ?? []).filter((a) => a.tier === "silver");
  const goldApps   = (applications ?? []).filter((a) => a.tier === "gold");

  return (
    <div className="min-h-screen pb-16 sm:pb-0">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 pt-10 pb-24 sm:px-6">

        {/* ── Page title ── */}
        <div className="mb-8">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Admin Panel</p>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Verification Management</h1>
          <p className="mt-1 text-sm text-muted-foreground">Review applications, grant or revoke badges, and manage the member directory.</p>
        </div>

        {/* ── Tab bar ── */}
        <div className="mb-6 flex gap-1 rounded-xl border border-border/50 bg-secondary/10 p-1 max-w-xs">
          <button
            type="button"
            onClick={() => setAdminTab("applications")}
            className={"flex flex-1 items-center justify-center gap-2 rounded-[9px] py-2 text-[13px] font-medium transition-all " +
              (adminTab === "applications" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground/80")}
          >
            <FileText className="h-3.5 w-3.5" />
            Applications
            {applications !== null && applications.length > 0 && (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500/80 px-1 text-[10px] font-bold text-black">
                {applications.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setAdminTab("members")}
            className={"flex flex-1 items-center justify-center gap-2 rounded-[9px] py-2 text-[13px] font-medium transition-all " +
              (adminTab === "members" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground/80")}
          >
            <Users className="h-3.5 w-3.5" />
            Members
          </button>
        </div>

        {/* ══════════════════════════════════════════════════════════════
            APPLICATIONS TAB
        ══════════════════════════════════════════════════════════════ */}
        {adminTab === "applications" && (
          <div className="space-y-8">
            {applications === null ? (
              <div className="text-sm text-muted-foreground">Loading applications…</div>
            ) : applications.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 px-8 py-16 text-center">
                <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">All clear</p>
                <p className="mt-1 text-xs text-muted-foreground">No pending applications right now.</p>
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">

                {/* ── Silver Builder column ── */}
                <div>
                  <div className="mb-4 flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "rgba(148,163,184,0.12)" }}>
                      <Github className="h-3.5 w-3.5" style={{ color: "#94a3b8" }} />
                    </div>
                    <h2 className="text-sm font-semibold" style={{ color: "#cbd5e1" }}>Pending Silver Builders</h2>
                    <span className="ml-auto text-xs text-muted-foreground">{silverApps.length} pending</span>
                  </div>

                  {silverApps.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-400/20 px-6 py-10 text-center">
                      <p className="text-xs text-muted-foreground">No pending Silver applications.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {silverApps.map((app) => (
                        <ApplicationCard
                          key={app.id}
                          app={app}
                          busy={!!reviewBusy[app.id]}
                          onApprove={() => review(app.id, "approve")}
                          onReject={() => review(app.id, "reject")}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Gold Investor column ── */}
                <div>
                  <div className="mb-4 flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "rgba(251,191,36,0.12)" }}>
                      <Building2 className="h-3.5 w-3.5" style={{ color: "#fbbf24" }} />
                    </div>
                    <h2 className="text-sm font-semibold" style={{ color: "#fde68a" }}>Pending Gold Investors</h2>
                    <span className="ml-auto text-xs text-muted-foreground">{goldApps.length} pending</span>
                  </div>

                  {goldApps.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-amber-500/20 px-6 py-10 text-center">
                      <p className="text-xs text-muted-foreground">No pending Gold applications.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {goldApps.map((app) => (
                        <ApplicationCard
                          key={app.id}
                          app={app}
                          busy={!!reviewBusy[app.id]}
                          onApprove={() => review(app.id, "approve")}
                          onReject={() => review(app.id, "reject")}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            MEMBERS TAB
        ══════════════════════════════════════════════════════════════ */}
        {adminTab === "members" && (
          <>
            <div className="mb-5">
              <input
                type="search"
                placeholder="Search by handle, name, or company…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full max-w-sm rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm outline-none focus:border-foreground/40"
              />
            </div>

            {profiles === null ? (
              <div className="text-sm text-muted-foreground">Loading profiles…</div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-border/60">
                <table className="w-full text-sm">
                  <thead className="border-b border-border/60 bg-secondary/20">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">User</th>
                      <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground sm:table-cell">Company</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Tier</th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {filteredProfiles.map((p) => (
                      <tr key={p.id} className="transition-colors hover:bg-secondary/10">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="grid h-8 w-8 shrink-0 overflow-hidden rounded-full border border-border bg-secondary/50 text-xs font-semibold">
                              {p.avatar_url
                                ? <img src={p.avatar_url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                                : <span className="grid h-full w-full place-items-center">{p.display_name.charAt(0).toUpperCase()}</span>}
                            </div>
                            <div>
                              <div className="flex items-center gap-1 font-medium">
                                {p.display_name}
                                <VerificationBadge tier={p.verification_tier} size={12} />
                              </div>
                              <div className="text-xs text-muted-foreground">@{p.handle}</div>
                            </div>
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{p.company_name ?? "—"}</td>
                        <td className="px-4 py-3">
                          <span className={
                            "rounded-full border px-2 py-0.5 text-xs font-medium " +
                            (p.verification_tier === "gold"
                              ? "border-amber-500/40 text-amber-400"
                              : p.verification_tier === "silver"
                                ? "border-slate-400/40 text-slate-300"
                                : "border-border text-muted-foreground")
                          }>
                            {p.verification_tier}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1.5">
                            {memberBusy[p.id] ? (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            ) : (
                              <>
                                {p.verification_tier !== "silver" && p.verification_tier !== "gold" && (
                                  <button type="button" onClick={() => setTier(p.id, "silver")}
                                    className="inline-flex items-center gap-1 rounded-md border border-slate-400/30 px-2 py-1 text-xs text-slate-300 transition-colors hover:border-slate-400/60 hover:bg-slate-400/10">
                                    <ShieldCheck className="h-3.5 w-3.5" /> Silver
                                  </button>
                                )}
                                {p.verification_tier !== "gold" && (
                                  <button type="button" onClick={() => setTier(p.id, "gold")}
                                    className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 px-2 py-1 text-xs text-amber-400 transition-colors hover:border-amber-500/60 hover:bg-amber-500/10">
                                    <ShieldCheck className="h-3.5 w-3.5" /> Gold
                                  </button>
                                )}
                                {p.verification_tier !== "none" && (
                                  <button type="button" onClick={() => setTier(p.id, "none")}
                                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-red-400/40 hover:text-red-400">
                                    <ShieldOff className="h-3.5 w-3.5" /> Revoke
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredProfiles.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No profiles found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ── Application review card ───────────────────────────────────────────────────
function ApplicationCard({
  app,
  busy,
  onApprove,
  onReject,
}: {
  app: ApplicationRow;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const isSilver = app.tier === "silver";
  const profile = app.profiles;

  const linkRows: { label: string; value: string | null; icon?: React.ReactNode }[] = isSilver
    ? [
        { label: "GitHub", value: app.github_url ?? app.link_primary, icon: <Github className="h-3 w-3" /> },
        { label: "Live Project", value: app.live_project_url ?? app.link_secondary, icon: <ExternalLink className="h-3 w-3" /> },
        { label: "Contract", value: app.deployed_contract_address, icon: null },
        { label: "Shipped", value: app.recent_ship_desc, icon: null },
      ]
    : [
        { label: "Fund / Company", value: app.fund_or_company_name, icon: <Building2 className="h-3 w-3" /> },
        { label: "Portfolio", value: app.portfolio_url ?? app.link_primary, icon: <ExternalLink className="h-3 w-3" /> },
        { label: "LinkedIn / X", value: app.linkedin_or_x_url ?? app.link_secondary, icon: <ExternalLink className="h-3 w-3" /> },
        { label: "Invite Code", value: app.invite_code, icon: null },
      ];

  const borderColor = isSilver ? "rgba(148,163,184,0.18)" : "rgba(251,191,36,0.22)";
  const bgColor     = isSilver ? "rgba(148,163,184,0.04)" : "rgba(251,191,36,0.04)";

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ border: `1px solid ${borderColor}`, background: bgColor }}>
      {/* User row */}
      <div className="flex items-center gap-2.5">
        <div className="grid h-9 w-9 shrink-0 overflow-hidden rounded-full border border-border bg-secondary/50 text-sm font-semibold">
          {profile?.avatar_url
            ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            : <span className="grid h-full w-full place-items-center">{(profile?.display_name ?? "?").charAt(0).toUpperCase()}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{profile?.display_name ?? "Unknown"}</p>
          <p className="text-xs text-muted-foreground">@{profile?.handle ?? "—"} · {timeAgo(app.created_at)}</p>
        </div>
      </div>

      {/* Link rows */}
      <div className="space-y-1.5 rounded-xl p-3" style={{ background: "rgba(0,0,0,0.20)" }}>
        {linkRows.filter((r) => r.value).map((r) => (
          <div key={r.label} className="flex items-start gap-2 text-xs">
            <span className="mt-0.5 shrink-0 text-muted-foreground">{r.icon ?? null}</span>
            <span className="w-20 shrink-0 text-muted-foreground">{r.label}</span>
            {r.value?.startsWith("http") ? (
              <a href={r.value} target="_blank" rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-foreground/80 underline underline-offset-2 hover:text-foreground">
                {r.value}
              </a>
            ) : (
              <span className="min-w-0 flex-1 truncate text-foreground/80">{r.value}</span>
            )}
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        {busy ? (
          <div className="flex flex-1 items-center justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={onApprove}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-400/10"
              style={{ border: "1px solid rgba(52,211,153,0.30)" }}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Approve
            </button>
            <button
              type="button"
              onClick={onReject}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold text-red-400 transition-colors hover:bg-red-400/10"
              style={{ border: "1px solid rgba(248,113,113,0.30)" }}
            >
              <XCircle className="h-3.5 w-3.5" />
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
}

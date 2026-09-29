import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ShieldCheck,
  ShieldOff,
  Loader2,
  Users,
  FileText,
  Github,
  ExternalLink,
  Building2,
  CheckCircle2,
  XCircle,
  Flag,
  ScrollText,
  Ban,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { VerificationBadge } from "@/components/VerificationBadge";
import { useAuth } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { reviewApplication, listPendingApplications } from "@/lib/verification.functions";
import {
  setVerificationTier,
  listMembers,
  setAccountStatus,
  listReports,
  resolveReport,
  listAdminActions,
} from "@/lib/admin.functions";
import { timeAgo } from "@/lib/time";
import { MAX_REPORT_REASON_LENGTH } from "@/lib/limits";
import type { AccountStatus, VerificationTier } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin Panel · The Ledger" }] }),
  // Restrict the panel to a dedicated hostname, set via VITE_ADMIN_DOMAIN
  // (e.g. "admin.example.com"). Authenticated routes are ssr:false, so this
  // always runs in the browser.
  //
  // In production a missing VITE_ADMIN_DOMAIN fails closed. Forgetting to set a
  // build arg should not silently publish the admin panel on the main domain.
  // Localhost is always allowed so `bun run dev` works without extra config.
  beforeLoad: () => {
    const adminDomain = import.meta.env.VITE_ADMIN_DOMAIN;
    const { hostname } = window.location;
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1";

    if (isLocal) return;
    if (!adminDomain) {
      if (import.meta.env.PROD) throw redirect({ to: "/feed" });
      return;
    }
    if (hostname !== adminDomain) throw redirect({ to: "/feed" });
  },
  component: AdminPage,
});

type ProfileRow = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  verification_tier: VerificationTier;
  company_name: string | null;
  role_type: string | null;
  onboarding_completed: boolean;
  account_status: AccountStatus;
  created_at: string;
};

type ReportRow = {
  id: string;
  reason: string | null;
  status: string;
  created_at: string;
  reporter: { id: string; handle: string; display_name: string } | null;
  post: {
    id: string;
    content: string;
    background: string | null;
    visibility: string | null;
    created_at: string;
    author: {
      id: string;
      handle: string;
      display_name: string;
      avatar_url: string | null;
      account_status: AccountStatus;
    } | null;
  } | null;
};

type AuditRow = {
  id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  detail: unknown;
  created_at: string;
  actor: { id: string; handle: string; display_name: string } | null;
};

type AdminTab = "applications" | "reports" | "members" | "audit";

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

function AdminPage() {
  // Admin status comes from the user_roles table only. There used to be a
  // VITE_ADMIN_IDS fallback, but VITE_* values are inlined into the public
  // bundle at build time, so it published the admin UUID to every visitor.
  const { isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const doReview = useServerFn(reviewApplication);
  const doListApplications = useServerFn(listPendingApplications);
  const doSetTier = useServerFn(setVerificationTier);
  const doListMembers = useServerFn(listMembers);
  const doSetAccountStatus = useServerFn(setAccountStatus);
  const doListReports = useServerFn(listReports);
  const doResolveReport = useServerFn(resolveReport);
  const doListAudit = useServerFn(listAdminActions);

  const [adminTab, setAdminTab] = useState<AdminTab>("applications");
  const [search, setSearch] = useState("");

  // Members
  const [profiles, setProfiles] = useState<ProfileRow[] | null>(null);
  const [memberBusy, setMemberBusy] = useState<Record<string, boolean>>({});

  // Applications
  const [applications, setApplications] = useState<ApplicationRow[] | null>(null);
  const [reviewBusy, setReviewBusy] = useState<Record<string, boolean>>({});

  // Moderation queue + audit trail
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [reportBusy, setReportBusy] = useState<Record<string, boolean>>({});
  const [audit, setAudit] = useState<AuditRow[] | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!isAdmin) navigate({ to: "/feed", replace: true });
  }, [loading, isAdmin, navigate]);

  // Served by a server function rather than a browser query: the directory needs
  // account_status, which is no longer readable by `authenticated`, and this puts
  // the whole listing behind a server-side admin check instead of a client flag.
  async function loadProfiles() {
    try {
      const data = await doListMembers({});
      setProfiles((data ?? []) as unknown as ProfileRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load members.");
    }
  }

  async function loadReports() {
    try {
      const data = await doListReports({});
      setReports((data ?? []) as unknown as ReportRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load reports.");
    }
  }

  async function loadAudit() {
    try {
      const data = await doListAudit({});
      setAudit((data ?? []) as unknown as AuditRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load the audit trail.");
    }
  }

  // Served by a server function because verification_requests is admin-gated.
  async function loadApplications() {
    try {
      const data = await doListApplications({});
      setApplications((data ?? []) as unknown as ApplicationRow[]);
    } catch (e) {
      console.error("[admin] loadApplications:", e);
      toast.error(e instanceof Error ? e.message : "Failed to load applications.");
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    loadProfiles();
    loadApplications();
    loadReports();
    loadAudit();
    // Intentionally keyed on isAdmin alone — these loaders are stable for the
    // lifetime of the page and re-running them on every render would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  /** Restrict, ban or reinstate a member. Enforcement is in RLS, not the UI. */
  async function changeAccountStatus(profileId: string, status: AccountStatus) {
    setMemberBusy((b) => ({ ...b, [profileId]: true }));
    try {
      await doSetAccountStatus({ data: { profileId, status } });
      setProfiles(
        (prev) =>
          prev?.map((p) => (p.id === profileId ? { ...p, account_status: status } : p)) ?? null,
      );
      toast.success(
        status === "active"
          ? "Member reinstated."
          : status === "restricted"
            ? "Member restricted — they can read but not post."
            : "Member suspended — their posts are now hidden.",
      );
      loadAudit();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update account status.");
    } finally {
      setMemberBusy((b) => ({ ...b, [profileId]: false }));
    }
  }

  async function decideReport(
    reportId: string,
    resolution: "actioned" | "dismissed",
    removePost: boolean,
    note: string,
  ) {
    setReportBusy((b) => ({ ...b, [reportId]: true }));
    try {
      const result = await doResolveReport({
        data: { reportId, resolution, removePost, note: note.trim() || undefined },
      });
      setReports((prev) => prev?.filter((r) => r.id !== reportId) ?? null);
      const extra =
        result.alsoResolved > 0
          ? ` ${result.alsoResolved} other report${result.alsoResolved === 1 ? "" : "s"} on the same post closed too.`
          : "";
      toast.success(
        (resolution === "actioned" ? "Report actioned." : "Report dismissed.") +
          (result.postRemoved ? " Post removed." : "") +
          extra,
      );
      loadAudit();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to resolve the report.");
    } finally {
      setReportBusy((b) => ({ ...b, [reportId]: false }));
    }
  }

  async function setTier(profileId: string, tier: VerificationTier) {
    setMemberBusy((b) => ({ ...b, [profileId]: true }));
    try {
      await doSetTier({ data: { profileId, tier } });
      setProfiles(
        (prev) =>
          prev?.map((p) => (p.id === profileId ? { ...p, verification_tier: tier } : p)) ?? null,
      );
      toast.success(
        tier === "none"
          ? "Verification revoked."
          : `${tier.charAt(0).toUpperCase() + tier.slice(1)} badge granted.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update tier.");
    } finally {
      setMemberBusy((b) => ({ ...b, [profileId]: false }));
    }
  }

  async function review(appId: string, action: "approve" | "reject") {
    setReviewBusy((b) => ({ ...b, [appId]: true }));
    try {
      const result = await doReview({ data: { applicationId: appId, action } });
      const outcome = action === "approve" ? "Application approved" : "Application rejected";
      toast.success(
        result.emailed
          ? `${outcome} — the applicant was notified by email.`
          : `${outcome}. No email was sent (unconfigured, opted out, or delivery failed) — they'll still see it in-app.`,
      );
      // Remove from pending list
      setApplications((prev) => prev?.filter((a) => a.id !== appId) ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Review failed.");
    } finally {
      setReviewBusy((b) => ({ ...b, [appId]: false }));
    }
  }

  if (loading || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const filteredProfiles = (profiles ?? []).filter(
    (p) =>
      !search ||
      p.handle.toLowerCase().includes(search.toLowerCase()) ||
      p.display_name.toLowerCase().includes(search.toLowerCase()) ||
      (p.company_name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const silverApps = (applications ?? []).filter((a) => a.tier === "silver");
  const goldApps = (applications ?? []).filter((a) => a.tier === "gold");

  return (
    <div className="min-h-screen pb-16 sm:pb-0">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 pt-10 pb-24 sm:px-6">
        {/* Page title */}
        <div className="mb-8">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Admin Panel
            </p>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Verification Management
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review applications, grant or revoke badges, and manage the member directory.
          </p>
        </div>

        {/* Tab bar */}
        <div className="mb-6 flex max-w-2xl gap-1 rounded-xl border border-border/50 bg-secondary/10 p-1">
          {(
            [
              {
                key: "applications",
                label: "Applications",
                icon: FileText,
                count: applications?.length,
              },
              { key: "reports", label: "Reports", icon: Flag, count: reports?.length },
              { key: "members", label: "Members", icon: Users, count: undefined },
              { key: "audit", label: "Audit", icon: ScrollText, count: undefined },
            ] as const
          ).map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              type="button"
              onClick={() => setAdminTab(key)}
              className={
                "flex flex-1 items-center justify-center gap-2 rounded-[9px] py-2 text-[13px] font-medium transition-all " +
                (adminTab === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground/80")
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {typeof count === "number" && count > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500/80 px-1 text-[10px] font-bold text-black">
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════
            REPORTS TAB
            The report button has been writing rows since launch behind a
            "the moderators will review" toast, with nothing on the other
            end reading them. This is the other end.
        ══════════════════════════════════════════════════════════════ */}
        {adminTab === "reports" && (
          <div className="space-y-4">
            {reports === null ? (
              <div className="text-sm text-muted-foreground">Loading reports…</div>
            ) : reports.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 px-8 py-16 text-center">
                <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">Queue is empty</p>
                <p className="mt-1 text-xs text-muted-foreground">No open reports right now.</p>
              </div>
            ) : (
              reports.map((r) => (
                <ReportCard
                  key={r.id}
                  report={r}
                  busy={!!reportBusy[r.id]}
                  onDecide={(resolution, removePost, note) =>
                    decideReport(r.id, resolution, removePost, note)
                  }
                  onRestrictAuthor={() =>
                    r.post?.author ? changeAccountStatus(r.post.author.id, "restricted") : undefined
                  }
                  onSuspendAuthor={() =>
                    r.post?.author ? changeAccountStatus(r.post.author.id, "banned") : undefined
                  }
                />
              ))
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            AUDIT TAB
        ══════════════════════════════════════════════════════════════ */}
        {adminTab === "audit" && (
          <div>
            <p className="mb-4 text-xs text-muted-foreground">
              Every badge grant, suspension, removal and review decision, newest first. Written
              server-side with no way to edit or delete an entry from the app.
            </p>
            {audit === null ? (
              <div className="text-sm text-muted-foreground">Loading audit trail…</div>
            ) : audit.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 px-8 py-16 text-center">
                <p className="text-sm font-medium text-foreground">Nothing logged yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Admin actions will appear here as they happen.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-border/50">
                {audit.map((entry, i) => (
                  <div
                    key={entry.id}
                    className={
                      "flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-xs " +
                      (i % 2 === 0 ? "bg-card/30" : "")
                    }
                  >
                    <code className="rounded bg-secondary/50 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                      {entry.action}
                    </code>
                    <span className="text-muted-foreground">
                      {entry.actor ? `@${entry.actor.handle}` : "unknown admin"}
                    </span>
                    <span className="text-muted-foreground/70">
                      {entry.target_type}
                      {entry.target_id ? ` ${entry.target_id.slice(0, 8)}` : ""}
                    </span>
                    <span className="ml-auto text-muted-foreground/60">
                      {timeAgo(entry.created_at)}
                    </span>
                    {entry.detail != null && Object.keys(entry.detail as object).length > 0 && (
                      <p className="w-full break-all font-mono text-[10px] text-muted-foreground/50">
                        {JSON.stringify(entry.detail)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
                <p className="mt-1 text-xs text-muted-foreground">
                  No pending applications right now.
                </p>
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Silver Builder column */}
                <div>
                  <div className="mb-4 flex items-center gap-2">
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-lg"
                      style={{ background: "rgba(148,163,184,0.12)" }}
                    >
                      <Github className="h-3.5 w-3.5" style={{ color: "#94a3b8" }} />
                    </div>
                    <h2 className="text-sm font-semibold" style={{ color: "#cbd5e1" }}>
                      Pending Silver Builders
                    </h2>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {silverApps.length} pending
                    </span>
                  </div>

                  {silverApps.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-400/20 px-6 py-10 text-center">
                      <p className="text-xs text-muted-foreground">
                        No pending Silver applications.
                      </p>
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

                {/* Gold Investor column */}
                <div>
                  <div className="mb-4 flex items-center gap-2">
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-lg"
                      style={{ background: "rgba(251,191,36,0.12)" }}
                    >
                      <Building2 className="h-3.5 w-3.5" style={{ color: "#fbbf24" }} />
                    </div>
                    <h2 className="text-sm font-semibold" style={{ color: "#fde68a" }}>
                      Pending Gold Investors
                    </h2>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {goldApps.length} pending
                    </span>
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
              <div className="overflow-x-auto rounded-2xl border border-border/60">
                <table className="w-full min-w-[480px] text-sm">
                  <thead className="border-b border-border/60 bg-secondary/20">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        User
                      </th>
                      <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground sm:table-cell">
                        Company
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Tier
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {filteredProfiles.map((p) => (
                      <tr key={p.id} className="transition-colors hover:bg-secondary/10">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="grid h-8 w-8 shrink-0 overflow-hidden rounded-full border border-border bg-secondary/50 text-xs font-semibold">
                              {p.avatar_url ? (
                                <img
                                  src={p.avatar_url}
                                  alt=""
                                  className="h-full w-full object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <span className="grid h-full w-full place-items-center">
                                  {p.display_name.charAt(0).toUpperCase()}
                                </span>
                              )}
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
                        <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                          {p.company_name ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              "rounded-full border px-2 py-0.5 text-xs font-medium " +
                              (p.verification_tier === "gold"
                                ? "border-amber-500/40 text-amber-400"
                                : p.verification_tier === "silver"
                                  ? "border-slate-400/40 text-slate-300"
                                  : "border-border text-muted-foreground")
                            }
                          >
                            {p.verification_tier}
                          </span>
                          {p.account_status !== "active" && (
                            <span
                              className={
                                "ml-1.5 rounded-full border px-2 py-0.5 text-xs font-medium " +
                                (p.account_status === "banned"
                                  ? "border-red-500/40 text-red-400"
                                  : "border-amber-500/40 text-amber-400")
                              }
                            >
                              {p.account_status === "banned" ? "suspended" : "restricted"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {memberBusy[p.id] ? (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            ) : (
                              <>
                                {p.verification_tier !== "silver" &&
                                  p.verification_tier !== "gold" && (
                                    <button
                                      type="button"
                                      onClick={() => setTier(p.id, "silver")}
                                      className="inline-flex items-center gap-1 rounded-md border border-slate-400/30 px-2 py-1 text-xs text-slate-300 transition-colors hover:border-slate-400/60 hover:bg-slate-400/10"
                                    >
                                      <ShieldCheck className="h-3.5 w-3.5" /> Silver
                                    </button>
                                  )}
                                {p.verification_tier !== "gold" && (
                                  <button
                                    type="button"
                                    onClick={() => setTier(p.id, "gold")}
                                    className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 px-2 py-1 text-xs text-amber-400 transition-colors hover:border-amber-500/60 hover:bg-amber-500/10"
                                  >
                                    <ShieldCheck className="h-3.5 w-3.5" /> Gold
                                  </button>
                                )}
                                {p.verification_tier !== "none" && (
                                  <button
                                    type="button"
                                    onClick={() => setTier(p.id, "none")}
                                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-red-400/40 hover:text-red-400"
                                  >
                                    <ShieldOff className="h-3.5 w-3.5" /> Revoke
                                  </button>
                                )}

                                {/*
                                  Moderation. Until now the strongest sanction was
                                  revoking a badge, which does nothing to stop an
                                  abusive account posting. Enforcement is in RLS,
                                  so these buttons change behaviour, not just a
                                  label.
                                */}
                                {p.account_status === "active" ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => changeAccountStatus(p.id, "restricted")}
                                      className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 px-2 py-1 text-xs text-amber-400 transition-colors hover:border-amber-500/60 hover:bg-amber-500/10"
                                      title="Read-only: cannot post, comment, like, re-ship or message"
                                    >
                                      <Ban className="h-3.5 w-3.5" /> Restrict
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => changeAccountStatus(p.id, "banned")}
                                      className="inline-flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-xs text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/10"
                                      title="Read-only and their posts are hidden from everyone"
                                    >
                                      <Ban className="h-3.5 w-3.5" /> Suspend
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => changeAccountStatus(p.id, "active")}
                                    className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 px-2 py-1 text-xs text-emerald-400 transition-colors hover:border-emerald-500/60 hover:bg-emerald-500/10"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" /> Reinstate
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
                        <td
                          colSpan={4}
                          className="px-4 py-8 text-center text-sm text-muted-foreground"
                        >
                          No profiles found.
                        </td>
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

// Application review card
/**
 * One open report, with the reported content and the decisions available.
 *
 * Shows the post itself rather than just an id — a moderator deciding on content
 * they cannot see is not moderating.
 */
function ReportCard({
  report,
  busy,
  onDecide,
  onRestrictAuthor,
  onSuspendAuthor,
}: {
  report: ReportRow;
  busy: boolean;
  onDecide: (resolution: "actioned" | "dismissed", removePost: boolean, note: string) => void;
  onRestrictAuthor: () => void;
  onSuspendAuthor: () => void;
}) {
  const [note, setNote] = useState("");
  const author = report.post?.author;

  return (
    <div className="rounded-2xl border border-border/50 bg-card/30 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Flag className="h-3.5 w-3.5 text-amber-400" />
        <span>
          Reported by{" "}
          <span className="font-medium text-foreground">
            @{report.reporter?.handle ?? "unknown"}
          </span>
        </span>
        <span className="ml-auto">{timeAgo(report.created_at)}</span>
      </div>

      <div className="mt-3 rounded-xl border border-border/50 bg-background/40 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Reason
        </p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground/90">
          {report.reason?.trim() || (
            <span className="italic text-muted-foreground">
              No reason given (reported before the reason field existed)
            </span>
          )}
        </p>
      </div>

      {report.post ? (
        <div className="mt-3 rounded-xl border border-border/50 bg-background/40 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Post by</span>
            <span className="font-medium text-foreground">
              {author?.display_name ?? "unknown"} @{author?.handle ?? "?"}
            </span>
            {author && author.account_status !== "active" && (
              <span className="rounded-full border border-red-500/40 px-2 py-0.5 text-[10px] font-medium text-red-400">
                {author.account_status === "banned" ? "suspended" : "restricted"}
              </span>
            )}
            <span className="ml-auto text-muted-foreground/60">
              {timeAgo(report.post.created_at)}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground/90">
            {report.post.content}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs italic text-muted-foreground">
          The reported post has already been deleted.
        </p>
      )}

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={MAX_REPORT_REASON_LENGTH}
        placeholder="Resolution note (optional, kept in the audit trail)"
        className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-foreground/40"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide("dismissed", false, note)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
          Dismiss
        </button>
        {report.post && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide("actioned", true, note)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove post
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide("actioned", false, note)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary/40 disabled:opacity-50"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Action without removing
        </button>

        {author && author.account_status === "active" && (
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onRestrictAuthor}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/10 disabled:opacity-50"
            >
              <Ban className="h-3.5 w-3.5" />
              Restrict author
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onSuspendAuthor}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            >
              <Ban className="h-3.5 w-3.5" />
              Suspend author
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

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
        {
          label: "GitHub",
          value: app.github_url ?? app.link_primary,
          icon: <Github className="h-3 w-3" />,
        },
        {
          label: "Live Project",
          value: app.live_project_url ?? app.link_secondary,
          icon: <ExternalLink className="h-3 w-3" />,
        },
        { label: "Contract", value: app.deployed_contract_address, icon: null },
        { label: "Shipped", value: app.recent_ship_desc, icon: null },
      ]
    : [
        {
          label: "Fund / Company",
          value: app.fund_or_company_name,
          icon: <Building2 className="h-3 w-3" />,
        },
        {
          label: "Portfolio",
          value: app.portfolio_url ?? app.link_primary,
          icon: <ExternalLink className="h-3 w-3" />,
        },
        {
          label: "LinkedIn / X",
          value: app.linkedin_or_x_url ?? app.link_secondary,
          icon: <ExternalLink className="h-3 w-3" />,
        },
        { label: "Invite Code", value: app.invite_code, icon: null },
      ];

  const borderColor = isSilver ? "rgba(148,163,184,0.18)" : "rgba(251,191,36,0.22)";
  const bgColor = isSilver ? "rgba(148,163,184,0.04)" : "rgba(251,191,36,0.04)";

  return (
    <div
      className="rounded-2xl p-4 space-y-3"
      style={{ border: `1px solid ${borderColor}`, background: bgColor }}
    >
      {/* User row */}
      <div className="flex items-center gap-2.5">
        <div className="grid h-9 w-9 shrink-0 overflow-hidden rounded-full border border-border bg-secondary/50 text-sm font-semibold">
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="grid h-full w-full place-items-center">
              {(profile?.display_name ?? "?").charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {profile?.display_name ?? "Unknown"}
          </p>
          <p className="text-xs text-muted-foreground">
            @{profile?.handle ?? "—"} · {timeAgo(app.created_at)}
          </p>
        </div>
      </div>

      {/* Link rows */}
      <div className="space-y-1.5 rounded-xl p-3" style={{ background: "rgba(0,0,0,0.20)" }}>
        {linkRows
          .filter((r) => r.value)
          .map((r) => (
            <div key={r.label} className="flex items-start gap-2 text-xs">
              <span className="mt-0.5 shrink-0 text-muted-foreground">{r.icon ?? null}</span>
              <span className="w-20 shrink-0 text-muted-foreground">{r.label}</span>
              {r.value?.startsWith("http") ? (
                <a
                  href={r.value}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-foreground/80 underline underline-offset-2 hover:text-foreground"
                >
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

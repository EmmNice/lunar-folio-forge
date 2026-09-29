import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Github,
  LogOut,
  Lock,
  EyeOff,
  MessageSquare,
  CheckCircle2,
  Circle,
  Inbox,
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import type { VerificationTier } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { acceptPitch } from "@/lib/pitch.functions";
import { VerificationBadge } from "@/components/VerificationBadge";
import { LuxToggle } from "@/components/LuxToggle";
import { NotificationPreferences } from "@/components/NotificationPreferences";
import { PITCH_INBOX_PAGE_SIZE, PITCH_LIMIT_OPTIONS } from "@/lib/limits";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Account Settings · The Ledger" }] }),
  component: AccountSettingsPage,
});

/** Groups related rows under a small caps heading. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </p>
      <div
        className="overflow-hidden rounded-2xl"
        style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(26,26,30,0.60)" }}
      >
        {children}
      </div>
    </div>
  );
}

/** A single row within a Section. */
function Row({ children, divider = true }: { children: React.ReactNode; divider?: boolean }) {
  return (
    <div
      className="px-5 py-4"
      style={divider ? { borderBottom: "1px solid rgba(255,255,255,0.05)" } : {}}
    >
      {children}
    </div>
  );
}

function AccountSettingsPage() {
  const { profile } = useAuth();
  const isGold = profile?.verification_tier === "gold";

  return (
    <div className="min-h-screen pb-16 sm:pb-0">
      <AppHeader />
      <main className="mx-auto max-w-lg px-4 pt-10 pb-mobile-nav sm:px-6">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
          The Ledger
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Account Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Security, privacy, and notification preferences.
        </p>

        <div className="mt-8 space-y-8">
          <SecuritySection />
          <PrivacySection />
          <NotificationsSection />
          {isGold && <PitchesSection />}
          <DangerSection />
        </div>
      </main>
    </div>
  );
}

/** Password changes and linked OAuth providers. */
function SecuritySection() {
  const { user } = useAuth();
  const [showPwForm, setShowPwForm] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [busy, setBusy] = useState(false);

  // Parse provider identities
  const identities = user?.identities ?? [];
  const hasGithub = identities.some((i) => i.provider === "github");
  const hasGoogle = identities.some((i) => i.provider === "google");
  const hasEmail = identities.some((i) => i.provider === "email");

  async function changePassword() {
    if (!newPw.trim()) {
      toast.error("Enter a new password.");
      return;
    }
    if (newPw !== confirmPw) {
      toast.error("Passwords don't match.");
      return;
    }
    if (newPw.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated.");
    setNewPw("");
    setConfirmPw("");
    setShowPwForm(false);
  }

  return (
    <Section title="Security & Auth">
      {/* Change Password */}
      <Row>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ background: "rgba(255,255,255,0.06)" }}
            >
              <Lock className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Change Password</p>
              <p className="text-[11px] text-muted-foreground">
                {hasEmail ? "Update your sign-in password." : "No email/password login linked."}
              </p>
            </div>
          </div>
          {hasEmail && (
            <button
              type="button"
              onClick={() => setShowPwForm((v) => !v)}
              className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              {showPwForm ? "Cancel" : "Change"}
            </button>
          )}
        </div>

        {showPwForm && (
          <div className="mt-4 space-y-2">
            <input
              type="password"
              className="lux-field"
              placeholder="New password (min 8 chars)"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
            />
            <input
              type="password"
              className="lux-field"
              placeholder="Confirm new password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
            />
            <button
              type="button"
              onClick={changePassword}
              disabled={busy}
              className="btn btn-primary btn-block"
              style={{ background: "#F5F5F6" }}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Update Password
            </button>
          </div>
        )}
      </Row>

      {/* Linked accounts */}
      <Row divider={false}>
        <p className="mb-3 text-xs font-medium text-muted-foreground">Linked Accounts</p>
        <div className="space-y-2.5">
          <LinkedAccount
            icon={<Github className="h-4 w-4" />}
            label="GitHub"
            connected={hasGithub}
          />
          <LinkedAccount
            icon={<span className="text-[13px] font-bold">G</span>}
            label="Google"
            connected={hasGoogle}
          />
        </div>
      </Row>
    </Section>
  );
}

function LinkedAccount({
  icon,
  label,
  connected,
}: {
  icon: React.ReactNode;
  label: string;
  connected: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        {icon}
      </div>
      <span className="flex-1 text-sm text-foreground/80">{label}</span>
      {connected ? (
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Connected
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Circle className="h-3.5 w-3.5" />
          Not linked
        </div>
      )}
    </div>
  );
}

/** DM restriction and search-engine visibility. */
function PrivacySection() {
  const { profile, user, refreshProfile } = useAuth();
  const [dmRestrict, setDmRestrict] = useState(profile?.dm_cloaking_enabled ?? false);
  const [hideSearch, setHideSearch] = useState(profile?.hide_from_search ?? false);
  const [busyDm, setBusyDm] = useState(false);
  const [busyHide, setBusyHide] = useState(false);

  async function toggleDm(next: boolean) {
    if (!user) return;
    setDmRestrict(next);
    setBusyDm(true);
    const { error } = await supabase
      .from("profiles")
      .update({ dm_cloaking_enabled: next })
      .eq("id", user.id);
    setBusyDm(false);
    if (error) {
      toast.error(error.message);
      setDmRestrict(!next);
      return;
    }
    await refreshProfile();
    toast.success(next ? "DMs restricted to verified members." : "DM restriction removed.");
  }

  async function toggleHideSearch(next: boolean) {
    if (!user) return;
    setHideSearch(next);
    setBusyHide(true);
    const { error } = await supabase
      .from("profiles")
      .update({ hide_from_search: next })
      .eq("id", user.id);
    setBusyHide(false);
    if (error) {
      toast.error(error.message);
      setHideSearch(!next);
      return;
    }
    await refreshProfile();
    toast.success(
      next ? "Profile hidden from search engines." : "Profile visible to search engines.",
    );
  }

  return (
    <Section title="Privacy & Network">
      <Row>
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ background: "rgba(255,255,255,0.06)" }}
            >
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Restrict DMs to Verified Members</p>
              <p className="text-[11px] text-muted-foreground">
                Only Silver &amp; Gold users can see your message button.
              </p>
            </div>
          </div>
          <LuxToggle checked={dmRestrict} onChange={toggleDm} disabled={busyDm} />
        </div>
      </Row>

      <Row divider={false}>
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ background: "rgba(255,255,255,0.06)" }}
            >
              <EyeOff className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Hide Profile from Search Engines</p>
              <p className="text-[11px] text-muted-foreground">
                Adds a noindex directive to your public profile.
              </p>
            </div>
          </div>
          <LuxToggle checked={hideSearch} onChange={toggleHideSearch} disabled={busyHide} />
        </div>
      </Row>
    </Section>
  );
}

function NotificationsSection() {
  return (
    <Section title="Notification Preferences">
      <NotificationPreferences />
    </Section>
  );
}

/** Inbound pitch quota and inbox. Gold members only. */
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

function PitchesSection() {
  const { profile, user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const accept = useServerFn(acceptPitch);
  const [pitchLimit, setPitchLimit] = useState<number | null>(profile?.pitch_limit ?? null);
  const [busy, setBusy] = useState(false);
  const [pitches, setPitches] = useState<PitchRow[] | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  useEffect(() => {
    if (user) loadPitches();
    // Load once per signed-in user; loadPitches is redeclared each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      .limit(PITCH_INBOX_PAGE_SIZE);
    setPitches((data ?? []) as unknown as PitchRow[]);
  }

  async function saveLimit() {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ pitch_limit: pitchLimit })
      .eq("id", user.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
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
      .update({ status: "declined" })
      .eq("id", pitchId);
    setActionBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPitches((prev) => prev?.filter((x) => x.id !== pitchId) ?? null);
  }

  return (
    <Section title="Inbound Pitches">
      <Row>
        <div className="flex items-center gap-3 mb-3">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: "rgba(251,191,36,0.10)" }}
          >
            <Inbox className="h-4 w-4 text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-medium">Pitch Inbox Limit</p>
            <p className="text-[11px] text-muted-foreground">
              Control how many pitches you receive per week.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {PITCH_LIMIT_OPTIONS.map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => setPitchLimit(opt.value)}
              className="rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors"
              style={
                pitchLimit === opt.value
                  ? {
                      borderColor: "rgba(251,191,36,0.40)",
                      background: "rgba(251,191,36,0.08)",
                      color: "#fbbf24",
                    }
                  : { borderColor: "rgba(255,255,255,0.07)", color: "#6B6B7A" }
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
          className="mt-3 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ background: "#F5F5F6" }}
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save limit
        </button>
      </Row>

      <Row divider={false}>
        <p className="mb-3 text-sm font-medium">Pending Pitches</p>
        {pitches === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : pitches.length === 0 ? (
          <div
            className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground"
            style={{ borderColor: "rgba(255,255,255,0.10)" }}
          >
            No pending pitches.
          </div>
        ) : (
          <div className="space-y-3">
            {pitches.map((p) => (
              <div
                key={p.id}
                className="rounded-xl p-4"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="grid h-9 w-9 shrink-0 overflow-hidden rounded-full text-xs font-semibold"
                    style={{ background: "rgba(255,255,255,0.08)" }}
                  >
                    {p.sender?.avatar_url ? (
                      <img
                        src={p.sender.avatar_url}
                        alt=""
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="grid h-full w-full place-items-center">
                        {(p.sender?.display_name ?? "?").charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      {p.sender?.display_name ?? "Unknown"}
                      <VerificationBadge
                        tier={(p.sender?.verification_tier ?? "none") as VerificationTier}
                        size={12}
                      />
                      <span className="text-xs text-muted-foreground">@{p.sender?.handle}</span>
                    </div>
                    <p className="mt-0.5 text-xs font-semibold text-amber-400/80">
                      {p.company_name}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-foreground/90">{p.pitch}</p>
                    {p.deck_url && (
                      <a
                        href={p.deck_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-2 inline-block text-xs text-amber-400 underline underline-offset-4 hover:text-amber-300"
                      >
                        View Deck →
                      </a>
                    )}
                  </div>
                </div>
                <div
                  className="mt-3 flex gap-2 border-t pt-3"
                  style={{ borderColor: "rgba(255,255,255,0.07)" }}
                >
                  <button
                    type="button"
                    onClick={() => handleAccept(p)}
                    disabled={actionBusy !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-xs font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {actionBusy === p.id + ":accept" && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDecline(p.id)}
                    disabled={actionBusy !== null}
                    className="rounded-lg border px-4 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    style={{ borderColor: "rgba(255,255,255,0.10)" }}
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
      </Row>
    </Section>
  );
}

/** Sign out. */
function DangerSection() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  return (
    <Section title="System Actions">
      <Row divider={false}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ background: "rgba(239,68,68,0.10)" }}
            >
              <LogOut className="h-4 w-4 text-red-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-red-400">Sign Out</p>
              <p className="text-[11px] text-muted-foreground">
                Destroy this session and return to the login page.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={signOut}
            disabled={busy}
            className="shrink-0 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all disabled:opacity-50"
            style={{
              background: "rgba(239,68,68,0.10)",
              border: "1px solid rgba(239,68,68,0.25)",
              color: "#f87171",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(239,68,68,0.18)";
              e.currentTarget.style.borderColor = "rgba(239,68,68,0.45)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(239,68,68,0.10)";
              e.currentTarget.style.borderColor = "rgba(239,68,68,0.25)";
            }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            Log Out
          </button>
        </div>
      </Row>
    </Section>
  );
}

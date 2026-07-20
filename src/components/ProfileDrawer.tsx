import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  User, LogOut, Lock, ShieldCheck, EyeOff, MessageSquare,
  Bell, ChevronDown, Github, CheckCircle2, Circle,
  Loader2, MonitorCog, Zap,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { VerificationBadge } from "@/components/VerificationBadge";
import { LedgerMark } from "@/components/AppHeader";
import { toast } from "sonner";

// ── Tier ring colour ──────────────────────────────────────────────────────────
function tierRingColor(tier?: string | null) {
  if (tier === "gold")   return "rgba(251,191,36,0.85)";
  if (tier === "silver") return "rgba(148,163,184,0.70)";
  return "rgba(255,255,255,0.15)";
}

// ── Notification prefs (localStorage) ────────────────────────────────────────
const NOTIF_KEYS = {
  messages: "ledger_notif_messages",
  pitches:  "ledger_notif_pitches",
  system:   "ledger_notif_system",
} as const;
function readNotif(k: keyof typeof NOTIF_KEYS) {
  try { return localStorage.getItem(NOTIF_KEYS[k]) !== "false"; } catch { return true; }
}
function writeNotif(k: keyof typeof NOTIF_KEYS, v: boolean) {
  try { localStorage.setItem(NOTIF_KEYS[k], String(v)); } catch { /* ignore */ }
}

// ── Luxury toggle ─────────────────────────────────────────────────────────────
function LuxToggle({
  checked, onChange, disabled = false,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-5 w-9 shrink-0 rounded-full transition-all disabled:opacity-40"
      style={{
        background: checked ? "rgba(245,245,246,0.90)" : "rgba(255,255,255,0.10)",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform"
        style={{ transform: checked ? "translateX(16px)" : "translateX(2px)" }}
      />
    </button>
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────
function Divider() {
  return <div style={{ height: 1, background: "rgba(255,255,255,0.05)" }} />;
}

// ── Accordion section header ──────────────────────────────────────────────────
function SectionHeader({
  icon: Icon,
  label,
  open,
  onToggle,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  open: boolean;
  onToggle: () => void;
  accent?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-white/[0.04] active:bg-white/[0.06]"
    >
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={{ background: accent ?? "rgba(255,255,255,0.07)" }}
      >
        <Icon className="h-[14px] w-[14px]" style={{ color: accent ? "white" : "#94a3b8" }} />
      </div>
      <span className="flex-1 text-[13px] font-medium text-foreground/85">{label}</span>
      <ChevronDown
        className="h-3.5 w-3.5 text-muted-foreground/50 transition-transform duration-200"
        style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
      />
    </button>
  );
}

// ── Toggle row inside an open section ────────────────────────────────────────
function ToggleRow({
  label,
  desc,
  checked,
  onChange,
  disabled,
  last = false,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 px-5 py-3"
      style={last ? {} : { borderBottom: "1px solid rgba(255,255,255,0.04)" }}
    >
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-foreground/90 leading-tight">{label}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/70">{desc}</p>
      </div>
      <LuxToggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

// ── Main drawer ───────────────────────────────────────────────────────────────
export function ProfileDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // which accordion section is open
  const [openSection, setOpenSection] = useState<"security" | "privacy" | "notifications" | null>(null);

  // Security state
  const [showPwForm, setShowPwForm]   = useState(false);
  const [newPw, setNewPw]             = useState("");
  const [confirmPw, setConfirmPw]     = useState("");
  const [busyPw, setBusyPw]           = useState(false);

  // Privacy state
  const [dmRestrict, setDmRestrict]   = useState(profile?.dm_cloaking_enabled ?? false);
  const [hideSearch, setHideSearch]   = useState(profile?.hide_from_search ?? false);
  const [busyDm, setBusyDm]           = useState(false);
  const [busyHide, setBusyHide]       = useState(false);

  // Notification state
  const [notifMessages, setNotifMessages] = useState(() => readNotif("messages"));
  const [notifPitches, setNotifPitches]   = useState(() => readNotif("pitches"));
  const [notifSystem, setNotifSystem]     = useState(() => readNotif("system"));

  // Sign-out busy
  const [signingOut, setSigningOut] = useState(false);

  function close() { onOpenChange(false); }

  function toggleSection(s: typeof openSection) {
    setOpenSection((prev) => (prev === s ? null : s));
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  async function signOut() {
    setSigningOut(true);
    close();
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  async function changePassword() {
    if (!newPw.trim()) { toast.error("Enter a new password."); return; }
    if (newPw !== confirmPw) { toast.error("Passwords don't match."); return; }
    if (newPw.length < 8) { toast.error("Minimum 8 characters."); return; }
    setBusyPw(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setBusyPw(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Password updated.");
    setNewPw(""); setConfirmPw(""); setShowPwForm(false);
  }

  async function toggleDm(next: boolean) {
    if (!user) return;
    setDmRestrict(next);
    setBusyDm(true);
    const { error } = await supabase.from("profiles").update({ dm_cloaking_enabled: next } as any).eq("id", user.id);
    setBusyDm(false);
    if (error) { toast.error(error.message); setDmRestrict(!next); return; }
    await refreshProfile();
    toast.success(next ? "DMs restricted to verified members." : "DM restriction removed.");
  }

  async function toggleHide(next: boolean) {
    if (!user) return;
    setHideSearch(next);
    setBusyHide(true);
    const { error } = await supabase.from("profiles").update({ hide_from_search: next } as any).eq("id", user.id);
    setBusyHide(false);
    if (error) { toast.error(error.message); setHideSearch(!next); return; }
    await refreshProfile();
    toast.success(next ? "Profile hidden from search engines." : "Profile visible in search.");
  }

  function toggleNotif(k: keyof typeof NOTIF_KEYS, val: boolean, setter: (v: boolean) => void) {
    setter(val); writeNotif(k, val);
    toast.success("Saved.");
  }

  // Linked accounts
  const identities = user?.identities ?? [];
  const hasGithub  = identities.some((i) => i.provider === "github");
  const hasGoogle  = identities.some((i) => i.provider === "google");
  const hasEmail   = identities.some((i) => i.provider === "email");

  if (!user) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="flex w-[280px] flex-col border-r p-0 sm:max-w-[280px]"
        style={{ background: "#0B0B0C", borderColor: "rgba(255,255,255,0.07)" }}
      >
        {/* ── Profile header ─────────────────────────────────────────────── */}
        <div
          className="relative flex flex-col gap-3 px-5 pb-5 pt-8"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 200px 130px at 30px -20px, rgba(251,191,36,0.07) 0%, transparent 100%)",
            }}
          />

          {/* Avatar */}
          <div
            className="relative h-[60px] w-[60px] overflow-hidden rounded-full"
            style={{
              background: "rgba(255,255,255,0.07)",
              boxShadow: `0 0 0 2.5px ${tierRingColor(profile?.verification_tier)}, 0 0 0 4.5px #0B0B0C`,
            }}
          >
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="grid h-full w-full place-items-center text-xl font-semibold text-foreground/80">
                {profile?.display_name?.charAt(0).toUpperCase() ?? "?"}
              </span>
            )}
          </div>

          {/* Name + handle */}
          <div>
            <p className="flex items-center gap-1.5 text-[15px] font-semibold leading-tight tracking-[-0.02em]">
              {profile?.display_name ?? "—"}
              {profile && <VerificationBadge tier={profile.verification_tier} size={13} />}
            </p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              @{profile?.handle ?? "…"}
            </p>
          </div>

          {/* View profile CTA */}
          {profile ? (
            <Link
              to="/u/$handle"
              params={{ handle: profile.handle }}
              search={{ tab: undefined }}
              onClick={close}
              className="inline-flex w-fit items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-medium text-foreground/70 transition-colors hover:border-white/20 hover:text-foreground"
              style={{ borderColor: "rgba(255,255,255,0.10)" }}
            >
              <User className="h-3 w-3" />
              View profile
            </Link>
          ) : (
            <Link
              to="/onboarding"
              onClick={close}
              className="inline-flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-background transition-opacity hover:opacity-90"
              style={{ background: "#FBBF24" }}
            >
              <User className="h-3 w-3" />
              Complete your profile
            </Link>
          )}

          <div className="absolute right-4 top-4 opacity-[0.14]">
            <LedgerMark className="h-4 w-auto" />
          </div>
        </div>

        {/* ── Settings sections ──────────────────────────────────────────── */}
        <nav className="flex-1 overflow-y-auto">

          {/* Section label */}
          <p className="px-5 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/50">
            Account
          </p>

          {/* ── 1. Security & Auth ── */}
          <SectionHeader
            icon={ShieldCheck}
            label="Security & Auth"
            open={openSection === "security"}
            onToggle={() => toggleSection("security")}
          />

          {openSection === "security" && (
            <div
              className="mx-3 mb-2 overflow-hidden rounded-xl"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              {/* Change Password */}
              <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                    <div>
                      <p className="text-[12.5px] font-medium leading-tight">Change Password</p>
                      <p className="text-[11px] text-muted-foreground/70">
                        {hasEmail ? "Update your sign-in password." : "No email login linked."}
                      </p>
                    </div>
                  </div>
                  {hasEmail && (
                    <button
                      type="button"
                      onClick={() => setShowPwForm((v) => !v)}
                      className="shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      {showPwForm ? "Cancel" : "Change"}
                    </button>
                  )}
                </div>

                {showPwForm && (
                  <div className="mt-3 space-y-2">
                    <input
                      type="password"
                      className="lux-field text-sm"
                      placeholder="New password (min 8 chars)"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                    />
                    <input
                      type="password"
                      className="lux-field text-sm"
                      placeholder="Confirm new password"
                      value={confirmPw}
                      onChange={(e) => setConfirmPw(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={changePassword}
                      disabled={busyPw}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl py-2 text-[12px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                      style={{ background: "#F5F5F6" }}
                    >
                      {busyPw && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Update Password
                    </button>
                  </div>
                )}
              </div>

              {/* Linked accounts */}
              <div className="px-4 py-3">
                <p className="mb-2.5 text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">Linked Accounts</p>
                <div className="space-y-2">
                  {[
                    { icon: <Github className="h-3.5 w-3.5" />, label: "GitHub", connected: hasGithub },
                    { icon: <span className="text-[12px] font-bold leading-none">G</span>, label: "Google", connected: hasGoogle },
                  ].map(({ icon, label, connected }) => (
                    <div key={label} className="flex items-center gap-2.5">
                      <div
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
                      >
                        {icon}
                      </div>
                      <span className="flex-1 text-[12.5px] text-foreground/80">{label}</span>
                      {connected ? (
                        <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" /> Connected
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
                          <Circle className="h-3 w-3" /> Not linked
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <Divider />

          {/* ── 2. Privacy & Network ── */}
          <SectionHeader
            icon={EyeOff}
            label="Privacy & Network"
            open={openSection === "privacy"}
            onToggle={() => toggleSection("privacy")}
          />

          {openSection === "privacy" && (
            <div
              className="mx-3 mb-2 overflow-hidden rounded-xl"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <ToggleRow
                label="Restrict DMs to Verified"
                desc="Only Silver & Gold users see your message button."
                checked={dmRestrict}
                onChange={toggleDm}
                disabled={busyDm}
              />
              <ToggleRow
                label="Hide from Search Engines"
                desc="Adds noindex to your public profile page."
                checked={hideSearch}
                onChange={toggleHide}
                disabled={busyHide}
                last
              />
            </div>
          )}

          <Divider />

          {/* ── 3. Notification Preferences ── */}
          <SectionHeader
            icon={Bell}
            label="Notification Preferences"
            open={openSection === "notifications"}
            onToggle={() => toggleSection("notifications")}
          />

          {openSection === "notifications" && (
            <div
              className="mx-3 mb-2 overflow-hidden rounded-xl"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <ToggleRow
                label="New Message Alerts"
                desc="Notify when someone sends you a DM."
                checked={notifMessages}
                onChange={(v) => toggleNotif("messages", v, setNotifMessages)}
              />
              <ToggleRow
                label="Pitch Match Alerts"
                desc="Notify when a new pitch arrives."
                checked={notifPitches}
                onChange={(v) => toggleNotif("pitches", v, setNotifPitches)}
              />
              <ToggleRow
                label="System Updates"
                desc="Platform announcements & releases."
                checked={notifSystem}
                onChange={(v) => toggleNotif("system", v, setNotifSystem)}
                last
              />
            </div>
          )}

        </nav>

        {/* ── Sign Out ───────────────────────────────────────────────────── */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-red-500/[0.07] active:bg-red-500/[0.12] disabled:opacity-50"
          >
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              style={{ background: "rgba(239,68,68,0.12)" }}
            >
              {signingOut
                ? <Loader2 className="h-[14px] w-[14px] animate-spin text-red-400" />
                : <LogOut className="h-[14px] w-[14px] text-red-400" />
              }
            </div>
            <span className="text-[13px] font-medium text-red-400">Sign out</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

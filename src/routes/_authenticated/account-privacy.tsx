import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, MessageSquare, EyeOff, Ban, VolumeX, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { unblockMember } from "@/lib/social.functions";
import { unmuteMember } from "@/lib/social";

export const Route = createFileRoute("/_authenticated/account-privacy")({
  head: () => ({ meta: [{ title: "Privacy & Network · The Ledger" }] }),
  component: PrivacySettingsPage,
});

function LuxToggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
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

type SafetyProfile = {
  handle: string;
  display_name: string;
  avatar_url: string | null;
} | null;

type RawSafetyRow = {
  blocked_id?: string;
  muted_id?: string;
  created_at: string;
  profile: SafetyProfile;
};

type SafetyEntry = {
  id: string;
  profile: SafetyProfile;
};

/** One blocked-or-muted account, with the button that undoes it. */
function SafetyList({
  entries,
  emptyText,
  actionLabel,
  onRemove,
  busyRow,
}: {
  entries: SafetyEntry[] | null;
  emptyText: string;
  actionLabel: string;
  onRemove: (id: string) => void;
  busyRow: string | null;
}) {
  if (entries === null) {
    return (
      <div className="space-y-2 px-5 py-4">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="skeleton h-8 w-8 rounded-full" />
            <span className="skeleton h-3 w-32 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return <p className="px-5 py-4 text-[12px] text-muted-foreground">{emptyText}</p>;
  }

  return (
    <ul>
      {entries.map((e, i) => (
        <li
          key={e.id}
          className="flex items-center justify-between gap-4 px-5 py-3"
          style={i < entries.length - 1 ? { borderTop: "1px solid rgba(255,255,255,0.05)" } : {}}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 overflow-hidden rounded-full bg-secondary/60 text-[11px] font-semibold">
              {e.profile?.avatar_url ? (
                <img
                  src={e.profile.avatar_url}
                  alt=""
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="grid h-full w-full place-items-center">
                  {(e.profile?.display_name ?? "?").charAt(0).toUpperCase()}
                </span>
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {e.profile?.display_name ?? "Unknown member"}
              </p>
              {e.profile ? (
                <Link
                  to="/u/$handle"
                  params={{ handle: e.profile.handle }}
                  search={{ tab: undefined }}
                  className="text-[11px] text-muted-foreground hover:underline underline-offset-2"
                >
                  @{e.profile.handle}
                </Link>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onRemove(e.id)}
            disabled={busyRow === e.id}
            className="btn btn-outline btn-sm shrink-0"
          >
            {busyRow === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : actionLabel}
          </button>
        </li>
      ))}
    </ul>
  );
}

function PrivacySettingsPage() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();

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

  async function toggleHide(next: boolean) {
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
    toast.success(next ? "Profile hidden from search engines." : "Profile visible in search.");
  }

  /*
    Blocked and muted lists.

    A block or a mute with no way to see or undo it is a trap — the action is
    performed from someone's profile, and if you cannot remember whose, there is
    otherwise no route back. Both lists are select-own by policy, so this only ever
    shows the viewer's own entries.
  */
  const [blocked, setBlocked] = useState<SafetyEntry[] | null>(null);
  const [muted, setMuted] = useState<SafetyEntry[] | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const unblock = useServerFn(unblockMember);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [b, m] = await Promise.all([
        supabase
          .from("blocks")
          .select(
            "blocked_id, created_at, profile:profiles!blocks_blocked_id_fkey(handle, display_name, avatar_url)",
          )
          .order("created_at", { ascending: false }),
        supabase
          .from("mutes")
          .select(
            "muted_id, created_at, profile:profiles!mutes_muted_id_fkey(handle, display_name, avatar_url)",
          )
          .order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      setBlocked(
        ((b.data ?? []) as unknown as RawSafetyRow[]).map((r) => ({
          id: r.blocked_id as string,
          profile: r.profile,
        })),
      );
      setMuted(
        ((m.data ?? []) as unknown as RawSafetyRow[]).map((r) => ({
          id: r.muted_id as string,
          profile: r.profile,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function removeBlock(id: string) {
    setBusyRow(id);
    try {
      await unblock({ data: { targetId: id } });
      setBlocked((prev) => prev?.filter((e) => e.id !== id) ?? null);
      toast.success("Unblocked.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't unblock.");
    } finally {
      setBusyRow(null);
    }
  }

  async function removeMute(id: string) {
    if (!user) return;
    setBusyRow(id);
    const error = await unmuteMember(user.id, id);
    setBusyRow(null);
    if (error) {
      toast.error(error);
      return;
    }
    setMuted((prev) => prev?.filter((e) => e.id !== id) ?? null);
    toast.success("Unmuted.");
  }

  const rows = [
    {
      icon: MessageSquare,
      label: "Restrict DMs to Verified Members",
      desc: "Only Silver & Gold users can see your message button.",
      checked: dmRestrict,
      onChange: toggleDm,
      disabled: busyDm,
    },
    {
      icon: EyeOff,
      label: "Hide Profile from Search Engines",
      desc: "Adds a noindex directive to your public profile.",
      checked: hideSearch,
      onChange: toggleHide,
      disabled: busyHide,
    },
  ];

  return (
    <div className="min-h-screen" style={{ background: "#0B0B0C" }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-4"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <button type="button" onClick={() => navigate({ to: "/feed" })} className="btn-icon">
          <ArrowLeft className="h-5 w-5 text-muted-foreground" />
        </button>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-tertiary">
            Account
          </p>
          <h1 className="text-[17px] font-semibold tracking-tight">Privacy & Network</h1>
        </div>
      </div>

      <main className="mx-auto max-w-lg px-4 pt-8 pb-28">
        <div
          className="overflow-hidden rounded-2xl"
          style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(26,26,30,0.60)" }}
        >
          {rows.map((r, i) => (
            <div
              key={r.label}
              className="flex items-center justify-between gap-6 px-5 py-4"
              style={
                i < rows.length - 1 ? { borderBottom: "1px solid rgba(255,255,255,0.05)" } : {}
              }
            >
              <div className="flex items-center gap-3">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: "rgba(255,255,255,0.06)" }}
                >
                  <r.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">{r.label}</p>
                  <p className="text-[11px] text-muted-foreground">{r.desc}</p>
                </div>
              </div>
              <LuxToggle checked={r.checked} onChange={r.onChange} disabled={r.disabled} />
            </div>
          ))}
        </div>

        {/* Blocked */}
        <section className="mt-8">
          <div className="mb-2 flex items-center gap-2 px-1">
            <Ban className="h-3.5 w-3.5 text-red-400" />
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-tertiary">
              Blocked
            </h2>
            {blocked ? (
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {blocked.length}
              </span>
            ) : null}
          </div>
          <p className="mb-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
            Neither of you can see the other's posts, reply or send messages.
          </p>
          <div
            className="overflow-hidden rounded-2xl"
            style={{
              border: "1px solid rgba(255,255,255,0.07)",
              background: "rgba(26,26,30,0.60)",
            }}
          >
            <SafetyList
              entries={blocked}
              emptyText="You haven't blocked anyone."
              actionLabel="Unblock"
              onRemove={removeBlock}
              busyRow={busyRow}
            />
          </div>
        </section>

        {/* Muted */}
        <section className="mt-8">
          <div className="mb-2 flex items-center gap-2 px-1">
            <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-tertiary">
              Muted
            </h2>
            {muted ? (
              <span className="text-[10px] tabular-nums text-muted-foreground">{muted.length}</span>
            ) : null}
          </div>
          <p className="mb-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
            Their posts stay out of your feed. They aren't told, and you can still visit their
            profile.
          </p>
          <div
            className="overflow-hidden rounded-2xl"
            style={{
              border: "1px solid rgba(255,255,255,0.07)",
              background: "rgba(26,26,30,0.60)",
            }}
          >
            <SafetyList
              entries={muted}
              emptyText="You haven't muted anyone."
              actionLabel="Unmute"
              onRemove={removeMute}
              busyRow={busyRow}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

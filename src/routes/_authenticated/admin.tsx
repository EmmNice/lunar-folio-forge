import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, ShieldOff, Loader2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { VerificationBadge } from "@/components/VerificationBadge";
import { useAuth } from "@/hooks/use-auth";
import type { VerificationTier } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin Panel · The Ledger" }] }),
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
  created_at: string;
};

function AdminPage() {
  const { isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<ProfileRow[] | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!isAdmin) {
      navigate({ to: "/feed", replace: true });
    }
  }, [loading, isAdmin, navigate]);

  async function loadProfiles() {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, handle, display_name, avatar_url, verification_tier, company_name, role_type, onboarding_completed, created_at")
      .order("created_at", { ascending: false });
    if (error) { toast.error("Failed to load profiles."); return; }
    setProfiles((data ?? []) as ProfileRow[]);
  }

  useEffect(() => {
    if (isAdmin) loadProfiles();
  }, [isAdmin]);

  async function setTier(profileId: string, tier: VerificationTier) {
    setBusy((b) => ({ ...b, [profileId]: true }));
    const { error } = await supabase
      .from("profiles")
      .update({ verification_tier: tier })
      .eq("id", profileId);
    setBusy((b) => ({ ...b, [profileId]: false }));
    if (error) { toast.error(error.message); return; }
    toast.success(
      tier === "none"
        ? "Verification revoked."
        : `${tier.charAt(0).toUpperCase() + tier.slice(1)} badge granted.`,
    );
    setProfiles((prev) =>
      prev?.map((p) => (p.id === profileId ? { ...p, verification_tier: tier } : p)) ?? null,
    );
  }

  if (loading || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const filtered = (profiles ?? []).filter(
    (p) =>
      !search ||
      p.handle.toLowerCase().includes(search.toLowerCase()) ||
      p.display_name.toLowerCase().includes(search.toLowerCase()) ||
      (p.company_name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="min-h-screen pb-16 sm:pb-0">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 pt-10 pb-24 sm:px-6">
        <div className="mb-8">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Admin Panel
            </p>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Verification Management
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Grant or revoke Silver and Gold verification badges. Changes take effect immediately.
          </p>
        </div>

        <div className="mb-6">
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
                {filtered.map((p) => (
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
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {busy[p.id] ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : (
                          <>
                            {p.verification_tier !== "silver" && p.verification_tier !== "gold" && (
                              <button
                                type="button"
                                onClick={() => setTier(p.id, "silver")}
                                title="Grant Silver"
                                className="inline-flex items-center gap-1 rounded-md border border-slate-400/30 px-2 py-1 text-xs text-slate-300 transition-colors hover:border-slate-400/60 hover:bg-slate-400/10"
                              >
                                <ShieldCheck className="h-3.5 w-3.5" /> Silver
                              </button>
                            )}
                            {p.verification_tier !== "gold" && (
                              <button
                                type="button"
                                onClick={() => setTier(p.id, "gold")}
                                title="Grant Gold"
                                className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 px-2 py-1 text-xs text-amber-400 transition-colors hover:border-amber-500/60 hover:bg-amber-500/10"
                              >
                                <ShieldCheck className="h-3.5 w-3.5" /> Gold
                              </button>
                            )}
                            {p.verification_tier !== "none" && (
                              <button
                                type="button"
                                onClick={() => setTier(p.id, "none")}
                                title="Revoke"
                                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-red-400/40 hover:text-red-400"
                              >
                                <ShieldOff className="h-3.5 w-3.5" /> Revoke
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No profiles found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

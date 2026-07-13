import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings · Godson" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setHandle(profile.handle);
    setDisplayName(profile.display_name);
    setBio(profile.bio ?? "");
    setAvatarUrl(profile.avatar_url ?? "");
  }, [profile]);

  async function save() {
    if (!profile) return;
    if (!/^[a-z0-9_]{2,20}$/.test(handle)) {
      toast.error("Handle must be 2–20 chars: lowercase letters, numbers, or _.");
      return;
    }
    if (!displayName.trim()) {
      toast.error("Display name is required.");
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
      })
      .eq("id", profile.id);
    setBusy(false);
    if (error) {
      toast.error(error.message.includes("profiles_handle_key") ? "That handle is taken." : error.message);
      return;
    }
    toast.success("Profile updated.");
    navigate({ to: "/u/$handle", params: { handle } });
  }

  const field =
    "w-full rounded-md border border-border bg-secondary/40 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-foreground/40";

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-lg px-4 pt-10 pb-24 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
        <div className="mt-8 space-y-5">
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
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Bio</label>
            <textarea rows={3} className={field + " resize-y"} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Avatar URL</label>
            <input className={field} value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
          </div>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="w-full rounded-md bg-foreground px-4 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </main>
    </div>
  );
}

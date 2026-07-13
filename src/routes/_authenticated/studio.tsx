import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import { Download, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { StatusCard, type Background } from "@/components/StatusCard";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/studio")({
  head: () => ({ meta: [{ title: "Workspace Studio · The Ledger" }] }),
  component: StudioPage,
});

const MAX = 280;

function StudioPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [content, setContent] = useState(
    "Building quiet software with loud ambition. Notes from the workshop, shipped daily.",
  );
  const [background, setBackground] = useState<Background>("noir");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url ?? null);
  const [busy, setBusy] = useState<"download" | "publish" | null>(null);

  const exportRef = useRef<HTMLDivElement | null>(null);

  const name = profile?.display_name ?? "";
  const handle = profile?.handle ?? "";
  const remaining = MAX - content.length;

  async function handleDownload() {
    if (!exportRef.current) return;
    setBusy("download");
    try {
      const dataUrl = await toPng(exportRef.current, {
        pixelRatio: 1,
        cacheBust: true,
        backgroundColor: background === "noir" ? "#0b0b0c" : "#f5f0e6",
        width: 1080,
        height: 1920,
      });
      const link = document.createElement("a");
      link.download = `${(handle || "status").toLowerCase()}-whatsapp-status.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handlePublish() {
    if (!profile) return;
    const body = content.trim();
    if (!body) {
      toast.error("Write something first.");
      return;
    }
    if (body.length > MAX) {
      toast.error(`Posts are limited to ${MAX} characters.`);
      return;
    }
    setBusy("publish");
    const { error } = await supabase.from("posts").insert({
      author_id: profile.id,
      content: body,
      background,
    });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Published to The Ledger.");
    navigate({ to: "/feed" });
  }

  const field =
    "w-full rounded-md border border-border bg-secondary/40 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-foreground/40";
  const bgBtn = (active: boolean) =>
    "rounded-md border px-3 py-2 text-xs font-medium transition-colors " +
    (active
      ? "border-foreground bg-foreground text-background"
      : "border-border text-muted-foreground hover:text-foreground");

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 pt-10 pb-24 sm:px-6">
        <div className="mb-8">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Workspace Studio
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Write a card
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A standalone canvas for crafting share-ready status cards — publish live to the Explore
            Feed, or download a graphic for WhatsApp Status.
          </p>
        </div>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="order-2 lg:order-1">
            <div className="mx-auto w-full max-w-[320px]">
              <StatusCard
                name={name}
                handle={handle}
                avatarUrl={avatarUrl}
                content={content}
                background={background}
                verificationTier={profile?.verification_tier}
              />
            </div>
          </div>

          <div className="order-1 space-y-5 lg:order-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Content
                </label>
                <span
                  className={
                    "text-xs tabular-nums " +
                    (remaining < 0
                      ? "text-red-400"
                      : remaining <= 20
                        ? "text-amber-400"
                        : "text-muted-foreground")
                  }
                >
                  {remaining}
                </span>
              </div>
              <textarea
                rows={7}
                maxLength={MAX + 40}
                className={field + " resize-y leading-relaxed"}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write your post…"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">
                Background
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setBackground("noir")} className={bgBtn(background === "noir")}>
                  Tech Noir
                </button>
                <button type="button" onClick={() => setBackground("cream")} className={bgBtn(background === "cream")}>
                  Premium Cream
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">
                Avatar
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAvatarUrl(profile?.avatar_url ?? null)}
                  className={bgBtn(avatarUrl === (profile?.avatar_url ?? null))}
                >
                  Google avatar
                </button>
                <button
                  type="button"
                  onClick={() => setAvatarUrl(null)}
                  className={bgBtn(avatarUrl === null)}
                >
                  Initial only
                </button>
              </div>
              <input
                type="url"
                placeholder="Or paste an image URL…"
                className={field}
                value={avatarUrl ?? ""}
                onChange={(e) => setAvatarUrl(e.target.value || null)}
              />
            </div>

            <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleDownload}
                disabled={busy !== null}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
              >
                {busy === "download" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download for WhatsApp
              </button>
              <button
                type="button"
                onClick={handlePublish}
                disabled={busy !== null || remaining < 0 || content.trim() === ""}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-foreground px-4 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Publish Live
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Download exports at 1080×1920 · perfect for WhatsApp Status.
            </p>
          </div>
        </div>

        {/* Off-screen full-resolution render for export */}
        <div
          aria-hidden
          style={{ position: "fixed", top: 0, left: 0, pointerEvents: "none", opacity: 0, zIndex: -1 }}
        >
          <StatusCard
            ref={exportRef}
            name={name}
            handle={handle}
            avatarUrl={avatarUrl}
            content={content}
            background={background}
            verificationTier={profile?.verification_tier}
            watermark
            exportMode
          />
        </div>
      </main>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { toPng } from "html-to-image";
import { Loader2, Send, X, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatusCard, BACKGROUND_BASE_COLORS } from "@/components/StatusCard";
import { useAuth } from "@/hooks/use-auth";
import type { Background } from "@/components/StatusCard";
import type { FeedPost } from "@/components/PostCard";

const MAX = 280;

export function ComposerModal({
  onClose,
  onPublished,
}: {
  onClose: () => void;
  onPublished?: (post: FeedPost) => void;
}) {
  const { user, profile } = useAuth();
  const [composer, setComposer] = useState("");
  const [background, setBackground] = useState<Background>("noir");
  const [busy, setBusy] = useState<"publish" | "download" | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const [exportData, setExportData] = useState<FeedPost | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on open
  useEffect(() => { textareaRef.current?.focus(); }, []);

  // Handle graphic export
  useEffect(() => {
    if (!exportData || !exportRef.current) return;
    (async () => {
      try {
        const dataUrl = await toPng(exportRef.current!, {
          pixelRatio: 1,
          cacheBust: true,
          backgroundColor: BACKGROUND_BASE_COLORS[exportData.background] ?? "#0b0b0c",
          width: 1080,
          height: 1920,
        });
        const link = document.createElement("a");
        link.download = `${exportData.author.handle}-status.png`;
        link.href = dataUrl;
        link.click();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Export failed.");
      } finally {
        setExportData(null);
        setBusy(null);
      }
    })();
  }, [exportData]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function publish() {
    if (!user || !profile) { toast.error("Sign in to publish."); return; }
    const body = composer.trim();
    if (!body) return;
    if (body.length > MAX) { toast.error(`Posts are limited to ${MAX} characters.`); return; }
    setBusy("publish");
    const { data, error } = await supabase
      .from("posts")
      .insert({ author_id: profile.id, content: body, background })
      .select("id, content, background, created_at")
      .single();
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Published live to The Ledger.");
    const newPost: FeedPost = {
      id: data.id,
      content: data.content,
      background: data.background as Background,
      comments_enabled: true,
      visibility: "public",
      created_at: data.created_at,
      author: {
        id: profile.id,
        handle: profile.handle,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        verification_tier: profile.verification_tier,
      },
    };
    onPublished?.(newPost);
    onClose();
  }

  async function downloadGraphic() {
    if (!profile) { toast.error("Sign in to create a graphic."); return; }
    const body = composer.trim();
    if (!body) { toast.error("Write something first."); return; }
    setBusy("download");
    setExportData({
      id: "draft",
      content: body,
      background,
      comments_enabled: true,
      visibility: "public",
      created_at: new Date().toISOString(),
      author: {
        id: profile.id,
        handle: profile.handle,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        verification_tier: profile.verification_tier,
      },
    });
  }

  const remaining = MAX - composer.length;

  const bgBtn = (active: boolean) =>
    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors " +
    (active
      ? "border-foreground bg-foreground text-background"
      : "border-border text-muted-foreground hover:text-foreground");

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Modal */}
      <div
        className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+80px)] z-50 mx-auto max-w-lg rounded-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2"
        style={{
          background: "rgba(20,20,24,0.98)",
          border: "1px solid rgba(255,255,255,0.10)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
        }}
      >
        {/* Modal header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <p className="text-sm font-semibold tracking-tight">New Card</p>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
            style={{ background: "rgba(255,255,255,0.05)" }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Composer body */}
        <div className="px-5 py-4">
          {/* Author chip */}
          {profile && (
            <div className="mb-4 flex items-center gap-2.5">
              <div
                className="grid h-8 w-8 shrink-0 overflow-hidden rounded-full text-xs font-semibold"
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
              <div>
                <p className="text-[13px] font-medium">{profile.display_name}</p>
                <p className="text-[11px] text-muted-foreground">@{profile.handle}</p>
              </div>
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={4}
            maxLength={MAX + 40}
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            placeholder="What's happening in your build today?"
            className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
          />

          {/* Card style */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground/70">Style:</span>
            <button type="button" onClick={() => setBackground("noir")} className={bgBtn(background === "noir")}>
              Tech Noir
            </button>
            <button type="button" onClick={() => setBackground("cream")} className={bgBtn(background === "cream")}>
              Premium Cream
            </button>
          </div>
        </div>

        {/* Footer actions */}
        <div
          className="flex items-center justify-between px-5 py-3.5"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          <span
            className={
              "text-xs tabular-nums transition-colors " +
              (remaining < 0
                ? "font-medium text-red-400"
                : remaining <= 20
                  ? "font-medium text-amber-400"
                  : "text-muted-foreground/60")
            }
          >
            {remaining}
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={downloadGraphic}
              disabled={busy !== null || !composer.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-40"
            >
              {busy === "download" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
              Graphic
            </button>
            <button
              type="button"
              onClick={publish}
              disabled={busy !== null || !composer.trim() || remaining < 0}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: "#F5F5F6" }}
            >
              {busy === "publish" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Publish
            </button>
          </div>
        </div>
      </div>

      {/* Off-screen export render */}
      {exportData && (
        <div aria-hidden style={{ position: "fixed", top: 0, left: 0, pointerEvents: "none", opacity: 0, zIndex: -1 }}>
          <StatusCard
            ref={exportRef}
            name={exportData.author.display_name}
            handle={exportData.author.handle}
            avatarUrl={exportData.author.avatar_url}
            content={exportData.content}
            background={exportData.background}
            verificationTier={exportData.author.verification_tier}
            watermark
            exportMode
          />
        </div>
      )}
    </>
  );
}

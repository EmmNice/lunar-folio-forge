import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { toPng } from "html-to-image";
import { Download, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { describeWriteError } from "@/lib/db-errors";
import { StatusCard, BACKGROUND_BASE_COLORS } from "@/components/StatusCard";
import { useAuth } from "@/hooks/use-auth";
import type { Background } from "@/components/StatusCard";
import type { FeedPost } from "@/components/PostCard";
import { MAX_POST_LENGTH } from "@/lib/limits";
import { tierAction } from "@/lib/tier-style";

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
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

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
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function publish() {
    if (!user || !profile) {
      toast.error("Sign in to publish.");
      return;
    }
    const body = composer.trim();
    if (!body) return;
    if (body.length > MAX_POST_LENGTH) {
      toast.error(`Posts are limited to ${MAX_POST_LENGTH} characters.`);
      return;
    }
    setBusy("publish");
    const { data, error } = await supabase
      .from("posts")
      .insert({ author_id: profile.id, content: body, background })
      .select("id, content, background, created_at")
      .single();
    setBusy(null);
    if (error) {
      toast.error(describeWriteError(error.message, "publish this"));
      return;
    }
    toast.success("Your post was sent.");
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
    if (!profile) {
      toast.error("Sign in to create a graphic.");
      return;
    }
    const body = composer.trim();
    if (!body) {
      toast.error("Write something first.");
      return;
    }
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

  const remaining = MAX_POST_LENGTH - composer.length;

  const action = tierAction(profile?.verification_tier);
  const canPost = busy === null && composer.trim() !== "" && remaining >= 0;

  /*
    The publish handlers check `profile`, but the markup below dereferenced it
    unconditionally — `profile.display_name.charAt(0)` for the avatar initial.
    `profile` is null whenever there is a session but no profile row: a signup
    whose profile insert failed, or a token still held for an account that has
    since been deleted. Opening the composer in that state threw during render,
    and React escalates a render throw to the route error boundary — so the whole
    page became "Something went wrong".

    Rendering nothing beats a nicer fallback avatar here: with no profile there is
    no author to attribute a post to, and the insert would be refused anyway.

    Placed after every hook, not at the top of the component, so the hook call
    order stays identical on every render.
  */
  if (!user || !profile) return null;

  return (
    <>
      {/*
        Compose, laid out like X: full screen on a phone, a centred sheet on
        desktop. Cancel top-left, Post top-right, avatar beside a large text box,
        and a slim toolbar along the bottom. The card style and Download live in
        that toolbar because they only affect the downloadable image — the post
        itself is plain text.
      */}
      <div
        className="fixed inset-0 z-50 hidden bg-[rgba(91,112,131,0.35)] sm:block"
        onClick={onClose}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Write a post"
        className="fixed inset-0 z-50 flex flex-col sm:inset-auto sm:left-1/2 sm:top-[6vh] sm:w-[600px] sm:max-w-[calc(100vw-2rem)] sm:-translate-x-1/2 sm:rounded-2xl"
        style={{
          background: "var(--bg-base)",
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        {/* Top bar */}
        <div className="flex h-14 shrink-0 items-center justify-between px-4">
          <button
            type="button"
            onClick={onClose}
            className="-ml-2 rounded-full px-2 py-1.5 text-[15px] text-foreground transition-colors hover:bg-white/[0.06] sm:hidden"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-ml-2 hidden h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-white/[0.08] sm:flex"
          >
            <X className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={publish}
            disabled={!canPost}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[15px] font-bold transition-opacity hover:opacity-90 sm:hidden"
            style={
              canPost
                ? { background: action.surface, color: action.ink }
                : { background: "var(--surface-3)", color: "var(--text-tertiary)" }
            }
          >
            {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Post
          </button>
        </div>

        {/* Avatar + text */}
        <div className="flex min-h-0 flex-1 gap-3 overflow-y-auto px-4 pt-1 sm:min-h-[180px] sm:flex-none">
          <div className="grid h-10 w-10 shrink-0 overflow-hidden rounded-full bg-secondary/60 text-[15px] font-bold text-foreground/70">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="grid h-full w-full place-items-center">
                {profile.display_name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <textarea
            ref={textareaRef}
            rows={5}
            maxLength={MAX_POST_LENGTH + 40}
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            placeholder="What's happening?"
            aria-label="Post text"
            className="min-w-0 flex-1 resize-none bg-transparent pt-1.5 text-[19px] leading-[1.4] text-foreground outline-none placeholder:text-tertiary"
            /* The global textarea rule draws a border and a focus glow; X's compose
               box has neither. Inline so it wins over that rule. */
            style={{ border: "none", boxShadow: "none", background: "transparent" }}
          />
        </div>

        {/* Toolbar */}
        <div
          className="flex shrink-0 items-center gap-1 border-t px-3 py-2 sm:mx-4 sm:px-0"
          style={{
            borderColor: "var(--border)",
            paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {/* Card style for the download: two dots */}
          {(
            [
              { id: "noir", label: "Noir card", color: "#0b0b0c" },
              { id: "cream", label: "Cream card", color: "#f5f0e6" },
            ] as { id: Background; label: string; color: string }[]
          ).map((o) => {
            const on = background === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setBackground(o.id)}
                aria-pressed={on}
                aria-label={o.label}
                title={`${o.label} when downloaded`}
                className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-white/[0.06]"
              >
                <span
                  className="block h-5 w-5 rounded-full"
                  style={{
                    background: o.color,
                    boxShadow: on
                      ? `0 0 0 2px var(--bg-base), 0 0 0 3.5px ${action.accent}`
                      : "inset 0 0 0 1px rgba(255,255,255,0.28)",
                  }}
                />
              </button>
            );
          })}

          <button
            type="button"
            onClick={downloadGraphic}
            disabled={busy !== null || !composer.trim()}
            aria-label="Download as a card"
            title="Download as a card"
            className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-white/[0.06] disabled:opacity-40"
            style={{ color: action.accent }}
          >
            {busy === "download" ? (
              <Loader2 className="h-[18px] w-[18px] animate-spin" />
            ) : (
              <Download className="h-[18px] w-[18px]" />
            )}
          </button>

          <div className="ml-auto flex items-center gap-3">
            <CharRing remaining={remaining} />
            <button
              type="button"
              onClick={publish}
              disabled={!canPost}
              className="hidden h-9 items-center gap-1.5 rounded-full px-4 text-[15px] font-bold transition-opacity hover:opacity-90 sm:inline-flex"
              style={
                canPost
                  ? { background: action.surface, color: action.ink }
                  : { background: "var(--surface-3)", color: "var(--text-tertiary)" }
              }
            >
              {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Post
            </button>
          </div>
        </div>
      </div>

      {/* Off-screen export render */}
      {exportData && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            pointerEvents: "none",
            opacity: 0,
            zIndex: -1,
          }}
        >
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

/**
 * X's character counter: a ring that fills as you type, turns amber with 20
 * left, shows the number from there, and goes red once you are over.
 */
function CharRing({ remaining }: { remaining: number }) {
  const used = MAX_POST_LENGTH - remaining;
  const r = 9;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, used / MAX_POST_LENGTH));
  const color = remaining < 0 ? "#f4212e" : remaining <= 20 ? "#ffd400" : "var(--foreground)";
  if (used === 0) return <span className="w-6" aria-hidden />;
  return (
    <span
      className="relative flex h-6 w-6 items-center justify-center"
      aria-label={`${remaining} characters left`}
    >
      <svg viewBox="0 0 24 24" className="absolute inset-0 -rotate-90">
        <circle cx="12" cy="12" r={r} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          strokeLinecap="round"
        />
      </svg>
      {remaining <= 20 ? (
        <span className="relative text-[10px] font-medium tabular-nums" style={{ color }}>
          {remaining}
        </span>
      ) : null}
    </span>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import { Download, Loader2, Send, Zap, Lock, MessageCircleOff, Info, Radio } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { AppHeader } from "@/components/AppHeader";
import { StatusCard, type Background } from "@/components/StatusCard";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { pulseAssistDraft } from "@/lib/pulse-assist.functions";

export const Route = createFileRoute("/_authenticated/studio")({
  head: () => ({ meta: [{ title: "Workspace Studio · The Ledger" }] }),
  component: StudioPage,
});

const MAX = 280;
type PulseMode = "polish" | "expand" | "shorten";

function StudioPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const assist = useServerFn(pulseAssistDraft);

  const [content, setContent] = useState(
    "Building quiet software with loud ambition. Notes from the workshop, shipped daily.",
  );
  const [background, setBackground] = useState<Background>("noir");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url ?? null);
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [visibility, setVisibility] = useState<"public" | "verified_only">("public");
  const [whisperFeed, setWhisperFeed] = useState(false);
  const [busy, setBusy] = useState<"download" | "publish" | null>(null);
  const [aiMode, setAiMode] = useState<PulseMode>("polish");
  const [aiLoading, setAiLoading] = useState(false);
  const [creditsLeft, setCreditsLeft] = useState<number | null>(null);
  const [showCreditWarning, setShowCreditWarning] = useState(false);

  const exportRef = useRef<HTMLDivElement | null>(null);

  const name = profile?.display_name ?? "";
  const handle = profile?.handle ?? "";
  const remaining = MAX - content.length;
  const isVerified = profile?.verification_tier !== "none";
  const isGold = profile?.verification_tier === "gold";
  const hasUnlimitedAI =
    isVerified || (profile?.subscription_status ?? "active") === "active";

  async function handlePulseAssist() {
    const body = content.trim();
    if (!body) { toast.error("Write something first."); return; }
    setAiLoading(true);
    try {
      const result = await assist({ data: { content: body, mode: aiMode } });
      setContent(result.text);
      if (result.creditsRemaining !== null) {
        setCreditsLeft(result.creditsRemaining);
        if (result.creditsRemaining === 0) {
          setShowCreditWarning(true);
        }
      }
      toast.success("PulseAssist updated your draft.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("CREDITS_EXHAUSTED")) {
        setShowCreditWarning(true);
        toast.error("No PulseAssist credits left today. Verify your account to unlock more.");
      } else if (msg.includes("AI_NOT_CONFIGURED")) {
        toast.error("PulseAssist requires an OPENAI_API_KEY in Replit secrets.");
      } else {
        toast.error("PulseAssist couldn't process your request. Try again.");
      }
    } finally {
      setAiLoading(false);
    }
  }

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
    if (!body) { toast.error("Write something first."); return; }
    if (body.length > MAX) { toast.error(`Posts are limited to ${MAX} characters.`); return; }
    setBusy("publish");
    // Whisper overrides verified_only; both require Silver/Gold to view
    const actualVisibility = whisperFeed ? "whisper" : visibility;
    const { error } = await supabase.from("posts").insert({
      author_id: profile.id,
      content: body,
      background,
      comments_enabled: commentsEnabled,
      visibility: actualVisibility,
    } as any);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
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
  const modeBtn = (active: boolean) =>
    "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors " +
    (active
      ? "border-violet-500/60 bg-violet-500/10 text-violet-300"
      : "border-border text-muted-foreground hover:text-foreground");

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 pt-10 pb-24 sm:px-6">
        <div className="mb-8">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Workspace Studio
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Write a card</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Craft a share-ready status card — publish live or download for WhatsApp Status.
          </p>
        </div>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* ── Preview ── */}
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

          {/* ── Controls ── */}
          <div className="order-1 space-y-5 lg:order-2">
            {/* Content + PulseAssist */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Content</label>
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

              {/* PulseAssist panel */}
              <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-violet-400" />
                    <span className="text-xs font-medium text-violet-300">PulseAssist AI</span>
                    {!hasUnlimitedAI && creditsLeft !== null && (
                      <span className="rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-400">
                        {creditsLeft}/3 credits
                      </span>
                    )}
                    {hasUnlimitedAI && (
                      <span className="rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-400">
                        Unlimited
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-violet-400/40">
                    Powered by PulseAssist
                  </span>
                </div>

                <div className="mb-2.5 flex gap-1.5 flex-wrap">
                  {(["polish", "expand", "shorten"] as PulseMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setAiMode(m)}
                      className={modeBtn(aiMode === m)}
                    >
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handlePulseAssist}
                  disabled={aiLoading || !content.trim()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-violet-600 px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {aiLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" />
                  )}
                  {aiMode === "polish" ? "Polish my draft" : aiMode === "expand" ? "Expand this" : "Shorten this"}
                </button>

                {/* Credit exhausted warning */}
                {showCreditWarning && !hasUnlimitedAI && (
                  <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300">
                    <Info className="mr-1.5 inline h-3.5 w-3.5" />
                    You've used your 3 free daily PulseAssist updates! Credits refresh daily, or verify your account to unlock more.
                  </div>
                )}
              </div>
            </div>

            {/* Background */}
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Background</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setBackground("noir")} className={bgBtn(background === "noir")}>Tech Noir</button>
                <button type="button" onClick={() => setBackground("cream")} className={bgBtn(background === "cream")}>Premium Cream</button>
              </div>
            </div>

            {/* Avatar */}
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Avatar</label>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setAvatarUrl(profile?.avatar_url ?? null)} className={bgBtn(avatarUrl === (profile?.avatar_url ?? null))}>Profile avatar</button>
                <button type="button" onClick={() => setAvatarUrl(null)} className={bgBtn(avatarUrl === null)}>Initial only</button>
              </div>
              <input
                type="url"
                placeholder="Or paste an image URL…"
                className={field}
                value={avatarUrl ?? ""}
                onChange={(e) => setAvatarUrl(e.target.value || null)}
              />
            </div>

            {/* Privacy controls (verified only) */}
            {isVerified && (
              <div className="space-y-3 rounded-xl border border-border/60 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" /> Privacy Controls
                </p>

                <label className="flex cursor-pointer items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-foreground">Verified audience only</p>
                    <p className="text-xs text-muted-foreground">Only Silver & Gold users can see this post</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={visibility === "verified_only"}
                    onClick={() => setVisibility((v) => (v === "verified_only" ? "public" : "verified_only"))}
                    className={
                      "relative h-5 w-9 rounded-full border transition-colors " +
                      (visibility === "verified_only"
                        ? "border-foreground bg-foreground"
                        : "border-border bg-border/30")
                    }
                  >
                    <span
                      className={
                        "absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform " +
                        (visibility === "verified_only" ? "translate-x-4" : "translate-x-0.5")
                      }
                    />
                  </button>
                </label>

                <label className="flex cursor-pointer items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-foreground">Turn off comments</p>
                    <p className="text-xs text-muted-foreground">No one can reply to this post</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!commentsEnabled}
                    onClick={() => setCommentsEnabled((v) => !v)}
                    className={
                      "relative h-5 w-9 rounded-full border transition-colors " +
                      (!commentsEnabled
                        ? "border-foreground bg-foreground"
                        : "border-border bg-border/30")
                    }
                  >
                    <span
                      className={
                        "absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform " +
                        (!commentsEnabled ? "translate-x-4" : "translate-x-0.5")
                      }
                    />
                  </button>
                </label>

                {/* Whisper Feed — Gold only */}
                {isGold && (
                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2.5">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-medium text-violet-300">
                        <Radio className="h-3.5 w-3.5" />
                        Publish to Whisper Feed
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Only Silver &amp; Gold members can see this post
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={whisperFeed}
                      onClick={() => setWhisperFeed((v) => !v)}
                      className={
                        "relative h-5 w-9 shrink-0 rounded-full border transition-colors " +
                        (whisperFeed
                          ? "border-violet-500 bg-violet-500"
                          : "border-border bg-border/30")
                      }
                    >
                      <span
                        className={
                          "absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform " +
                          (whisperFeed ? "translate-x-4" : "translate-x-0.5")
                        }
                      />
                    </button>
                  </label>
                )}
              </div>
            )}

            {/* Action buttons */}
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

        {/* Off-screen export render */}
        <div aria-hidden style={{ position: "fixed", top: 0, left: 0, pointerEvents: "none", opacity: 0, zIndex: -1 }}>
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

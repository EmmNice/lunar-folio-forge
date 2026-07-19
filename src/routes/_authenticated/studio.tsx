import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { Download, Loader2, Send, Zap, Lock, Info, Radio, Radio as LiveIcon } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { AppHeader } from "@/components/AppHeader";
import { StatusCard, type Background, BACKGROUND_BASE_COLORS } from "@/components/StatusCard";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { pulseAssistDraft } from "@/lib/pulse-assist.functions";

export const Route = createFileRoute("/_authenticated/studio")({
  head: () => ({ meta: [{ title: "Workspace · The Ledger" }] }),
  // Accept an optional ?draft= param from PulseAssist "Convert to Card"
  validateSearch: (s: Record<string, unknown>) => ({
    draft: typeof s.draft === "string" ? s.draft : undefined,
  }),
  component: StudioPage,
});

const MAX = 280;
type PulseMode = "polish" | "expand" | "shorten";

const field =
  "lux-field resize-y leading-relaxed";

function StudioPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ from: "/_authenticated/studio" });
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

  // Accept draft text from PulseAssist "Convert to Card"
  useEffect(() => {
    if (search.draft) setContent(search.draft);
  }, [search.draft]);

  const name = profile?.display_name ?? "";
  const handle = profile?.handle ?? "";
  const remaining = MAX - content.length;
  const isVerified = profile?.verification_tier !== "none";
  const isGold = profile?.verification_tier === "gold";
  const hasUnlimitedAI = isVerified;

  async function handlePulseAssist() {
    const body = content.trim();
    if (!body) { toast.error("Write something first."); return; }
    setAiLoading(true);
    try {
      const result = await assist({ data: { content: body, mode: aiMode } });
      setContent(result.text);
      if (result.creditsRemaining !== null) {
        setCreditsLeft(result.creditsRemaining);
        if (result.creditsRemaining === 0) setShowCreditWarning(true);
      }
      toast.success("PulseAssist updated your draft.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("CREDITS_EXHAUSTED")) {
        setShowCreditWarning(true);
        toast.error("No PulseAssist credits left today. Verify to unlock unlimited.");
      } else if (msg.includes("AI_NOT_CONFIGURED")) {
        toast.error("Add OPENAI_API_KEY to Replit secrets to enable PulseAssist.");
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

  const modeBtn = (active: boolean) =>
    "rounded-md px-2.5 py-1.5 text-xs font-medium transition-all " +
    (active
      ? "bg-violet-500/15 text-violet-300"
      : "text-muted-foreground hover:text-foreground");

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 pt-10 pb-28 sm:px-6">
        <div className="mb-8">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Workspace
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Write a card</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Craft a share-ready status card — publish live or download for WhatsApp Status.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[360px_minmax(0,1fr)]">
          {/* ── Controls ── (left column on desktop, top on mobile) */}
          <div className="space-y-6">

            {/* ── Content textarea ── */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Content
                </label>
                <span className={
                  "text-xs tabular-nums " +
                  (remaining < 0 ? "text-red-400" : remaining <= 20 ? "text-amber-400" : "text-muted-foreground")
                }>
                  {remaining}
                </span>
              </div>
              <textarea
                rows={7}
                maxLength={MAX + 40}
                className={field}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write your post…"
              />
            </div>

            {/* ── PulseAssist panel ── */}
            <div
              className="rounded-2xl p-4"
              style={{
                background: "rgba(167,139,250,0.05)",
                border: "1px solid rgba(167,139,250,0.15)",
              }}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded-md bg-violet-500/20">
                    <Zap className="h-3 w-3 text-violet-400" />
                  </div>
                  <span className="text-xs font-semibold text-violet-200">PulseAssist AI</span>
                  {!hasUnlimitedAI && creditsLeft !== null && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-medium text-violet-300"
                      style={{ background: "rgba(167,139,250,0.12)" }}
                    >
                      {creditsLeft}/3 today
                    </span>
                  )}
                  {hasUnlimitedAI && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-medium text-violet-300"
                      style={{ background: "rgba(167,139,250,0.12)" }}
                    >
                      Unlimited
                    </span>
                  )}
                </div>
              </div>

              {/* Mode selector */}
              <div className="mb-3 flex gap-1 rounded-xl p-1" style={{ background: "rgba(0,0,0,0.20)" }}>
                {(["polish", "expand", "shorten"] as PulseMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAiMode(m)}
                    className={modeBtn(aiMode === m) + " flex-1 text-center"}
                  >
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={handlePulseAssist}
                disabled={aiLoading || !content.trim()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "rgba(124,58,237,0.80)" }}
              >
                {aiLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                {aiMode === "polish" ? "Polish my draft" : aiMode === "expand" ? "Expand this" : "Shorten this"}
              </button>

              {showCreditWarning && !hasUnlimitedAI && (
                <div
                  className="mt-3 flex items-start gap-2 rounded-xl p-3 text-xs text-amber-300/80"
                  style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.15)" }}
                >
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  Daily credits used. Verify your account to unlock unlimited PulseAssist.
                </div>
              )}
            </div>

            {/* ── Background theme picker ── */}
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Card Theme
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {(
                  [
                    { id: "noir",     label: "Noir",     swatch: "#0b0b0c",    ring: "ring-white/20" },
                    { id: "cream",    label: "Cream",    swatch: "#f5f0e6",    ring: "ring-black/15" },
                    { id: "gradient", label: "Violet",   swatch: "#1a0d2e",    ring: "ring-violet-400/30",  accent: "#a78bfa" },
                    { id: "gold",     label: "Gold",     swatch: "#211700",    ring: "ring-amber-400/30",   accent: "#fbbf24" },
                    { id: "steel",    label: "Steel",    swatch: "#0d1525",    ring: "ring-slate-400/30",   accent: "#94a3b8" },
                    { id: "emerald",  label: "Emerald",  swatch: "#061a0e",    ring: "ring-emerald-400/30", accent: "#34d399" },
                    { id: "midnight", label: "Midnight", swatch: "#060d20",    ring: "ring-indigo-400/30",  accent: "#6366f1" },
                  ] as { id: Background; label: string; swatch: string; ring: string; accent?: string }[]
                ).map(({ id, label, swatch, ring, accent }) => {
                  const isActive = background === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setBackground(id)}
                      title={label}
                      className={
                        "flex flex-col items-center gap-1.5 rounded-xl p-2 transition-all " +
                        (isActive
                          ? "ring-1 ring-white/30 bg-white/06"
                          : "hover:bg-white/04")
                      }
                      style={isActive ? { background: "rgba(255,255,255,0.06)" } : {}}
                    >
                      <span
                        className={`block h-7 w-7 rounded-full ring-1 ${ring} shrink-0`}
                        style={{
                          background: accent
                            ? `radial-gradient(circle at 35% 35%, ${accent}55, ${swatch})`
                            : swatch,
                          boxShadow: isActive ? `0 0 0 2px ${accent ?? "#ffffff"}44` : undefined,
                        }}
                      />
                      <span className={`text-[10px] font-medium ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Avatar ── */}
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Avatar</label>
              <div
                className="flex items-center rounded-xl p-1"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
              >
                {[
                  { label: "Profile photo", val: profile?.avatar_url ?? null },
                  { label: "Initial only", val: null },
                ].map(({ label, val }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setAvatarUrl(val)}
                    className={
                      "flex flex-1 items-center justify-center rounded-lg py-2.5 text-xs font-medium transition-all " +
                      (avatarUrl === val
                        ? "bg-foreground text-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                type="url"
                placeholder="Or paste a custom image URL…"
                className="lux-field"
                value={avatarUrl ?? ""}
                onChange={(e) => setAvatarUrl(e.target.value || null)}
              />
            </div>

            {/* ── Privacy controls (verified only) ── */}
            {isVerified && (
              <div
                className="space-y-3 rounded-2xl p-4"
                style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}
              >
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  <Lock className="h-3 w-3" /> Privacy Controls
                </p>

                <Toggle
                  label="Verified audience only"
                  description="Only Silver & Gold users can see this post"
                  checked={visibility === "verified_only"}
                  onChange={() => setVisibility((v) => (v === "verified_only" ? "public" : "verified_only"))}
                />

                <Toggle
                  label="Turn off comments"
                  description="No one can reply to this post"
                  checked={!commentsEnabled}
                  onChange={() => setCommentsEnabled((v) => !v)}
                />

                {isGold && (
                  <div
                    className="rounded-xl p-3"
                    style={{ background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.18)" }}
                  >
                    <Toggle
                      label={
                        <span className="flex items-center gap-1.5 text-violet-300">
                          <Radio className="h-3 w-3" /> Publish to Whisper Feed
                        </span>
                      }
                      description="Only Silver & Gold members can see this post"
                      checked={whisperFeed}
                      onChange={() => setWhisperFeed((v) => !v)}
                      gold
                    />
                  </div>
                )}
              </div>
            )}

            {/* ── Action buttons ── */}
            <div className="flex items-center gap-3 pt-1">
              {/* Download — borderless icon button */}
              <button
                type="button"
                onClick={handleDownload}
                disabled={busy !== null}
                title="Download for WhatsApp (1080×1920)"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-all hover:text-foreground disabled:opacity-50"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                {busy === "download" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </button>

              {/* Publish Live — high-contrast accent button */}
              <button
                type="button"
                onClick={handlePublish}
                disabled={busy !== null || remaining < 0 || content.trim() === ""}
                className="flex flex-1 items-center justify-center gap-2.5 rounded-xl py-3 font-mono text-xs font-bold uppercase tracking-[0.12em] text-background transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: "#F5F5F6", letterSpacing: "0.12em" }}
              >
                {busy === "publish" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LiveIcon className="h-3.5 w-3.5" />
                )}
                Publish Live
              </button>
            </div>

            <p className="text-[11px] text-muted-foreground/60">
              Download exports at 1080×1920 · perfect for WhatsApp Status.
            </p>
          </div>

          {/* ── Live Preview ── (right column on desktop, below controls on mobile) */}
          <div className="flex flex-col items-center">
            <p className="mb-3 self-start text-xs font-medium uppercase tracking-wider text-muted-foreground lg:self-auto">
              Preview
            </p>
            {/* Sticky so it stays in view while scrolling controls on desktop */}
            <div className="w-full lg:sticky lg:top-24">
              <div className="mx-auto w-full max-w-[280px] sm:max-w-[320px]">
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
          </div>
        </div>

        {/* Off-screen export render */}
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

// ── Reusable luxury toggle ──────────────────────────────────────────────────
function Toggle({
  label,
  description,
  checked,
  onChange,
  gold = false,
}: {
  label: React.ReactNode;
  description: string;
  checked: boolean;
  onChange: () => void;
  gold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className="relative h-5 w-9 shrink-0 rounded-full transition-all"
        style={{
          background: checked
            ? gold
              ? "rgba(167,139,250,0.80)"
              : "rgba(245,245,246,0.90)"
            : "rgba(255,255,255,0.10)",
          border: "1px solid rgba(255,255,255,0.10)",
        }}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform"
          style={{
            transform: checked ? "translateX(16px)" : "translateX(2px)",
          }}
        />
      </button>
    </div>
  );
}

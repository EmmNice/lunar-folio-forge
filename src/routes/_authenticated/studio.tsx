import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { Download, Loader2, Send, Zap, Info, Radio } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { AppHeader } from "@/components/AppHeader";
import { StatusCard, type Background, BACKGROUND_BASE_COLORS } from "@/components/StatusCard";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { describeWriteError } from "@/lib/db-errors";
import { pulseAssistDraft } from "@/lib/pulse-assist.functions";
import { MAX_POST_LENGTH } from "@/lib/limits";
import { tierAction } from "@/lib/tier-style";

export const Route = createFileRoute("/_authenticated/studio")({
  head: () => ({ meta: [{ title: "Workspace · The Ledger" }] }),
  // Accept an optional ?draft= param from PulseAssist AI "Convert to Card"
  validateSearch: (s: Record<string, unknown>) => ({
    draft: typeof s.draft === "string" ? s.draft : undefined,
  }),
  component: StudioPage,
});

type PulseMode = "polish" | "expand" | "shorten";

const THEME_OPTIONS: { id: Background; label: string; swatch: string; accent?: string }[] = [
  { id: "noir", label: "Noir", swatch: "#0b0b0c" },
  { id: "cream", label: "Cream", swatch: "#f5f0e6" },
  { id: "gradient", label: "Violet", swatch: "#1a0d2e", accent: "#a78bfa" },
  { id: "gold", label: "Gold", swatch: "#211700", accent: "#fbbf24" },
  { id: "steel", label: "Steel", swatch: "#0d1525", accent: "#94a3b8" },
  { id: "emerald", label: "Emerald", swatch: "#061a0e", accent: "#34d399" },
  { id: "midnight", label: "Midnight", swatch: "#060d20", accent: "#6366f1" },
];

/** Small uppercase section label, used for every group so they line up. */
function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
        {children}
      </p>
      {right}
    </div>
  );
}

function StudioPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ from: "/_authenticated/studio" });
  const assist = useServerFn(pulseAssistDraft);

  // Starts empty. It used to open with a sample sentence already typed in, which
  // read like somebody else's post and had to be deleted before you could write.
  const [content, setContent] = useState("");
  const [background, setBackground] = useState<Background>("noir");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url ?? null);
  // useState reads its initial value once, usually before the profile has loaded,
  // so the card fell back to your initial and "Show my photo" read Off. Adopt the
  // photo when it arrives, unless you have already switched it off yourself.
  const [photoTouched, setPhotoTouched] = useState(false);
  useEffect(() => {
    if (!photoTouched) setAvatarUrl(profile?.avatar_url ?? null);
  }, [profile?.avatar_url, photoTouched]);
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [visibility, setVisibility] = useState<"public" | "verified_only">("public");
  const [whisperFeed, setWhisperFeed] = useState(false);
  const [busy, setBusy] = useState<"download" | "publish" | null>(null);
  const [aiMode, setAiMode] = useState<PulseMode>("polish");
  const [aiLoading, setAiLoading] = useState(false);
  const [creditsLeft, setCreditsLeft] = useState<number | null>(null);
  const [showCreditWarning, setShowCreditWarning] = useState(false);

  const exportRef = useRef<HTMLDivElement | null>(null);

  // Accept draft text from PulseAssist AI "Convert to Card"
  useEffect(() => {
    if (search.draft) setContent(search.draft);
  }, [search.draft]);

  const name = profile?.display_name ?? "";
  const handle = profile?.handle ?? "";
  const remaining = MAX_POST_LENGTH - content.length;
  const isVerified = profile?.verification_tier !== "none";
  const isGold = profile?.verification_tier === "gold";
  const hasUnlimitedAI = isVerified;
  const action = tierAction(profile?.verification_tier);
  const canPost = busy === null && remaining >= 0 && content.trim() !== "";

  async function handlePulseAssist() {
    const body = content.trim();
    if (!body) {
      toast.error("Write something first.");
      return;
    }
    setAiLoading(true);
    try {
      const result = await assist({ data: { content: body, mode: aiMode } });
      setContent(result.text);
      if (result.creditsRemaining !== null) {
        setCreditsLeft(result.creditsRemaining);
        if (result.creditsRemaining === 0) setShowCreditWarning(true);
      }
      toast.success("PulseAssist AI updated your draft.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("CREDITS_EXHAUSTED")) {
        setShowCreditWarning(true);
        toast.error("No PulseAssist AI credits left today. Verify to unlock unlimited.");
      } else if (msg.includes("AI_NOT_CONFIGURED")) {
        toast.error("PulseAssist AI isn't available right now. Please try again later.");
      } else {
        toast.error("PulseAssist AI couldn't process your request. Try again.");
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
    if (!body) {
      toast.error("Write something first.");
      return;
    }
    if (body.length > MAX_POST_LENGTH) {
      toast.error(`Posts are limited to ${MAX_POST_LENGTH} characters.`);
      return;
    }
    setBusy("publish");
    const actualVisibility = whisperFeed ? "whisper" : visibility;
    const { error } = await supabase.from("posts").insert({
      author_id: profile.id,
      content: body,
      background,
      comments_enabled: commentsEnabled,
      visibility: actualVisibility,
    });
    setBusy(null);
    if (error) {
      toast.error(describeWriteError(error.message, "publish this"));
      return;
    }
    toast.success("Published to The Ledger.");
    navigate({ to: "/feed" });
  }

  const preview = (
    <div className="transition-opacity" style={{ opacity: content.trim() ? 1 : 0.55 }}>
      <StatusCard
        name={name}
        handle={handle}
        avatarUrl={avatarUrl}
        content={content || "Start typing…"}
        background={background}
        verificationTier={profile?.verification_tier}
      />
    </div>
  );

  const themeSwatches = (layout: "grid" | "row") => (
    <div
      className={layout === "grid" ? "grid grid-cols-4 gap-x-1 gap-y-3" : "flex flex-wrap gap-4"}
    >
      {THEME_OPTIONS.map(({ id, label, swatch, accent }) => {
        const isActive = background === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setBackground(id)}
            aria-pressed={isActive}
            aria-label={`${label} theme`}
            className="flex flex-col items-center gap-1.5"
          >
            <span
              className="block h-9 w-9 rounded-full transition-shadow min-[400px]:h-10 min-[400px]:w-10"
              style={{
                background: accent
                  ? `radial-gradient(circle at 35% 35%, ${accent}66, ${swatch})`
                  : swatch,
                boxShadow: isActive
                  ? `0 0 0 2px var(--bg-base), 0 0 0 4px ${accent ?? "#F5F5F6"}`
                  : "inset 0 0 0 1px rgba(255,255,255,0.16)",
              }}
            />
            <span
              className="text-[10px] font-medium min-[400px]:text-[11px]"
              style={{ color: isActive ? "var(--foreground)" : "var(--text-tertiary)" }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen">
      <AppHeader />
      {/*
        Laid out phone-first. The preview used to sit at the very bottom, under
        every control, so you could not see the card while writing it; it now
        comes first on a phone and stays pinned beside the controls on desktop.
        Publish lives in a bar that stays on screen instead of after the last
        toggle.
      */}
      <main className="mx-auto max-w-5xl px-4 pt-5 pb-mobile-nav sm:px-6 sm:pt-8">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight">Studio</h1>
            <p className="mt-0.5 text-[13px] text-tertiary">
              Design a card, then post it or save it for your status.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-10">
          {/* Preview — right-hand column on desktop (on a phone it sits under the text box) */}
          <div className="hidden lg:order-2 lg:block">
            <div className="lg:sticky lg:top-24">
              <div className="mx-auto w-full max-w-[240px] sm:max-w-[280px] lg:max-w-[320px]">
                {preview}
              </div>
              <p className="mt-2 text-center text-[11px] text-tertiary">
                Live preview · downloads at 1080×1920
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="min-w-0 space-y-5 lg:order-1">
            {/* Text */}
            <section>
              <SectionLabel
                right={
                  <span
                    className={
                      "text-[12px] tabular-nums " +
                      (remaining < 0
                        ? "text-red-400"
                        : remaining <= 20
                          ? "text-amber-400"
                          : "text-tertiary")
                    }
                  >
                    {remaining}
                  </span>
                }
              >
                Text
              </SectionLabel>
              <textarea
                rows={5}
                maxLength={MAX_POST_LENGTH + 40}
                className="lux-field resize-none text-[15px] leading-relaxed"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="What are you shipping?"
              />
            </section>

            {/*
              Card: on a phone the preview sits beside the theme picker, so tapping
              a theme changes the card right next to your thumb. It used to be a
              full-width card that filled the screen and slid under the Save/Post
              bar, with the themes in a sideways-scrolling row that clipped the
              selected ring and showed a scrollbar.
            */}
            <section>
              <SectionLabel>Card</SectionLabel>
              <div className="flex items-start gap-4 lg:block">
                <div className="w-[132px] shrink-0 lg:hidden">{preview}</div>
                <div className="min-w-0 flex-1">
                  <div className="lg:hidden">{themeSwatches("grid")}</div>
                  <div className="hidden lg:block">{themeSwatches("row")}</div>
                </div>
              </div>
            </section>

            {/* PulseAssist AI — one compact row */}
            <section
              className="rounded-2xl p-3"
              style={{
                background: "rgba(167,139,250,0.05)",
                border: "1px solid rgba(167,139,250,0.15)",
              }}
            >
              <div className="mb-2.5 flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-violet-400" />
                <span className="text-[13px] font-semibold text-violet-200">PulseAssist AI</span>
                <span
                  className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium text-violet-300"
                  style={{ background: "rgba(167,139,250,0.12)" }}
                >
                  {hasUnlimitedAI
                    ? "Unlimited"
                    : creditsLeft !== null
                      ? `${creditsLeft}/3 today`
                      : "3 a day"}
                </span>
              </div>
              <div className="flex gap-2">
                <div
                  className="flex flex-1 gap-0.5 rounded-xl p-0.5"
                  style={{ background: "rgba(0,0,0,0.25)" }}
                >
                  {(["polish", "expand", "shorten"] as PulseMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setAiMode(m)}
                      className={
                        "flex-1 rounded-lg py-2 text-[12px] font-medium transition-colors " +
                        (aiMode === m
                          ? "bg-violet-500/20 text-violet-200"
                          : "text-tertiary hover:text-foreground")
                      }
                    >
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handlePulseAssist}
                  disabled={aiLoading || !content.trim()}
                  aria-label="Run PulseAssist AI"
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ background: "rgba(124,58,237,0.85)" }}
                >
                  {aiLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" />
                  )}
                  Go
                </button>
              </div>
              {showCreditWarning && !hasUnlimitedAI && (
                <p className="mt-2.5 flex items-start gap-1.5 text-[12px] text-amber-300/80">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  Daily credits used. Get verified for unlimited.
                </p>
              )}
            </section>

            {/* Options — one grouped list, like a settings screen */}
            <section>
              <SectionLabel>Options</SectionLabel>
              <div
                className="divide-y rounded-2xl"
                style={{
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid var(--border)",
                  borderColor: "var(--border)",
                }}
              >
                {/* Only offered when there is a photo to show; otherwise it was a
                    permanently greyed-out switch that looked broken. */}
                {profile?.avatar_url ? (
                  <div
                    className="flex items-center justify-between gap-4 px-4 py-3"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div>
                      <p className="text-[13px] font-medium">Show my photo</p>
                      <p className="text-[11px] text-tertiary">Off shows your initial instead</p>
                    </div>
                    <Switch
                      checked={!!avatarUrl}
                      onChange={() => {
                        setPhotoTouched(true);
                        setAvatarUrl(avatarUrl ? null : (profile?.avatar_url ?? null));
                      }}
                    />
                  </div>
                ) : null}

                {isVerified && (
                  <div className="px-4 py-3" style={{ borderColor: "var(--border)" }}>
                    <Toggle
                      label="Verified audience only"
                      description="Only Silver & Gold members can see it"
                      checked={visibility === "verified_only"}
                      onChange={() =>
                        setVisibility((v) => (v === "verified_only" ? "public" : "verified_only"))
                      }
                    />
                  </div>
                )}

                <div className="px-4 py-3" style={{ borderColor: "var(--border)" }}>
                  <Toggle
                    label="Turn off replies"
                    description="No one can reply to this post"
                    checked={!commentsEnabled}
                    onChange={() => setCommentsEnabled((v) => !v)}
                  />
                </div>

                {isGold && (
                  <div className="px-4 py-3" style={{ borderColor: "var(--border)" }}>
                    <Toggle
                      label={
                        <span className="flex items-center gap-1.5 text-violet-300">
                          <Radio className="h-3 w-3" /> Whisper Feed
                        </span>
                      }
                      description="Only Silver & Gold members can see it"
                      checked={whisperFeed}
                      onChange={() => setWhisperFeed((v) => !v)}
                      gold
                    />
                  </div>
                )}
              </div>
            </section>

            {/*
              Action bar. Sticky, so Publish is always one tap away while you
              scroll the options; on a phone it sits just above the tab bar.
            */}
            <div
              className="sticky z-30 -mx-4 flex items-center gap-3 border-t px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:px-0 sm:py-0"
              style={{
                bottom: "calc(var(--mobile-nav-height) + env(safe-area-inset-bottom, 0px))",
                borderColor: "var(--border)",
                background: "rgba(8,8,10,0.92)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
              }}
            >
              <button
                type="button"
                onClick={handleDownload}
                disabled={busy !== null || content.trim() === ""}
                aria-label="Download card"
                title="Download for WhatsApp Status (1080×1920)"
                className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full px-4 text-[14px] font-semibold transition-colors hover:bg-white/[0.06] disabled:opacity-40"
                style={{ border: "1px solid rgba(255,255,255,0.18)" }}
              >
                {busy === "download" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Save
              </button>
              <button
                type="button"
                onClick={handlePublish}
                disabled={!canPost}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-bold transition-colors hover:opacity-90"
                /* Faded gold read as dirty brown, not as "disabled". Grey does. */
                style={
                  canPost
                    ? { background: action.surface, color: action.ink }
                    : { background: "var(--surface-3)", color: "var(--text-tertiary)" }
                }
              >
                {busy === "publish" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Post
              </button>
            </div>
          </div>
        </div>

        {/* Off-screen export render */}
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

/** Bare on/off switch, shared look with Toggle. */
function Switch({
  checked,
  onChange,
  disabled = false,
  accent,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  /** On-colour for the track; defaults to white. */
  accent?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className="relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-40"
      style={{
        background: checked ? (accent ?? "#F5F5F6") : "rgba(255,255,255,0.18)",
      }}
    >
      <span
        className="absolute left-0 top-[3px] h-[18px] w-[18px] rounded-full shadow transition-transform"
        style={{
          background: checked ? (accent ? "#FFFFFF" : "#0B0B0C") : "#E4E4E7",
          transform: checked ? "translateX(19px)" : "translateX(3px)",
        }}
      />
    </button>
  );
}

// Reusable luxury toggle
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
        <p className="text-[13px] font-medium text-foreground">{label}</p>
        <p className="text-[11px] text-tertiary">{description}</p>
      </div>
      <Switch checked={checked} onChange={onChange} accent={gold ? "#a78bfa" : undefined} />
    </div>
  );
}

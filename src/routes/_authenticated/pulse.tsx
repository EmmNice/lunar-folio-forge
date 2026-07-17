import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Zap, Send, Sparkles, ChevronRight, RotateCcw, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import { pulseAssistChat } from "@/lib/pulse-chat.functions";

export const Route = createFileRoute("/_authenticated/pulse")({
  head: () => ({ meta: [{ title: "PulseAssist · The Ledger" }] }),
  component: PulsePage,
});

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const STARTERS = [
  "Help me write a punchy status update about my latest product milestone.",
  "I need a 280-char post that captures our traction this week.",
  "Polish this pitch opening: we're building the infra layer Web3 forgot.",
  "Write a bold investor update about hitting our first $10k MRR.",
];

function PulsePage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const chat = useServerFn(pulseAssistChat);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [creditsLeft, setCreditsLeft] = useState<number | null>(null);
  const [isUnlimited, setIsUnlimited] = useState<boolean>(false);
  const [exhausted, setExhausted] = useState(false);

  // Only treat as verified once the profile has actually loaded
  const isVerified =
    !!profile &&
    (profile.verification_tier === "silver" || profile.verification_tier === "gold");

  useEffect(() => {
    if (isVerified) setIsUnlimited(true);
  }, [isVerified]);

  function scrollToBottom() {
    queueMicrotask(() =>
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }),
    );
  }

  async function send(text?: string) {
    const body = (text ?? input).trim();
    if (!body || loading) return;
    if (exhausted) {
      toast.error("No credits left today. Verify your account to unlock unlimited PulseAssist.");
      return;
    }

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: body };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    scrollToBottom();

    try {
      const res = await chat({
        data: {
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        },
      });
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: res.reply,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      if (res.creditsRemaining !== null) {
        setCreditsLeft(res.creditsRemaining);
        if (res.creditsRemaining <= 0) setExhausted(true);
      }
      if (res.isUnlimited) setIsUnlimited(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("CREDITS_EXHAUSTED")) {
        setExhausted(true);
        toast.error("Daily credits used up. Verify to unlock unlimited PulseAssist.");
      } else if (msg.includes("AI_NOT_CONFIGURED")) {
        toast.error("Add OPENAI_API_KEY to Replit secrets to enable PulseAssist.");
      } else {
        toast.error("PulseAssist couldn't respond. Try again.");
      }
      // Remove the user message on failure so they can retry
      setMessages(nextMessages.slice(0, -1));
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function handleConvertToCard(content: string) {
    // Extract the most card-ready sentence (first ≤280 chars)
    const trimmed = content.slice(0, 280);
    navigate({
      to: "/studio",
      search: { draft: trimmed } as any,
    });
  }

  function reset() {
    setMessages([]);
    setInput("");
    inputRef.current?.focus();
  }

  const creditDisplay = () => {
    if (isUnlimited) {
      return (
        <div className="flex items-center gap-1.5 rounded-full border border-violet-500/20 bg-violet-500/8 px-3 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
          <span className="text-[11px] font-medium text-violet-300">Unlimited Fair Use</span>
        </div>
      );
    }
    if (creditsLeft === null) return null;
    return (
      <div
        className={
          "flex items-center gap-1.5 rounded-full border px-3 py-1 " +
          (creditsLeft === 0
            ? "border-red-500/20 bg-red-500/8"
            : creditsLeft === 1
              ? "border-amber-500/20 bg-amber-500/8"
              : "border-violet-500/20 bg-violet-500/8")
        }
      >
        <span
          className={
            "h-1.5 w-1.5 rounded-full " +
            (creditsLeft === 0 ? "bg-red-400" : creditsLeft === 1 ? "bg-amber-400" : "bg-violet-400")
          }
        />
        <span
          className={
            "text-[11px] font-medium tabular-nums " +
            (creditsLeft === 0
              ? "text-red-300"
              : creditsLeft === 1
                ? "text-amber-300"
                : "text-violet-300")
          }
        >
          {creditsLeft}/3 today
        </span>
      </div>
    );
  };

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />

      {/* ── Page chrome ── */}
      <div className="sticky top-14 z-30 flex items-center justify-between border-b px-4 py-2.5 backdrop-blur-md sm:px-6"
        style={{ background: "rgba(11,11,12,0.85)", borderColor: "rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-500/15">
            <Zap className="h-3.5 w-3.5 text-violet-400" />
          </div>
          <span className="text-sm font-semibold tracking-tight">PulseAssist</span>
          <span className="hidden text-xs text-muted-foreground sm:block">
            — your AI writing partner
          </span>
        </div>
        <div className="flex items-center gap-2">
          {creditDisplay()}
          {messages.length > 0 && (
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" /> New chat
            </button>
          )}
        </div>
      </div>

      {/* ── Chat area ── */}
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-6 sm:px-6">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto py-6">
          {messages.length === 0 ? (
            /* ── Empty state / starters ── */
            <div className="flex flex-col items-center py-10 text-center">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border bg-violet-500/10"
                style={{ borderColor: "rgba(167,139,250,0.20)" }}>
                <Zap className="h-6 w-6 text-violet-400" />
              </div>
              <h2 className="text-lg font-semibold tracking-tight">PulseAssist</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Your AI writing partner for The Ledger. Craft high-signal posts, sharpen pitches,
                and build your builder narrative.
              </p>

              {!isVerified && (
                <div className="mt-4 flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-xs text-amber-300/80"
                  style={{ borderColor: "rgba(251,191,36,0.15)", background: "rgba(251,191,36,0.05)" }}>
                  <Info className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  Unverified users get 3 free AI responses per day. Verify your account to unlock unlimited.
                </div>
              )}

              <div className="mt-8 w-full space-y-2">
                <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
                  Quick starts
                </p>
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="group flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-all hover:border-violet-500/30 hover:bg-violet-500/5"
                    style={{ borderColor: "rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}
                  >
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-400/60 transition-colors group-hover:text-violet-400" />
                    <span className="flex-1 text-muted-foreground transition-colors group-hover:text-foreground">{s}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={"flex " + (m.role === "user" ? "justify-end" : "justify-start")}
              >
                {m.role === "assistant" && (
                  <div className="mr-2.5 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/15">
                    <Zap className="h-3.5 w-3.5 text-violet-400" />
                  </div>
                )}
                <div className={m.role === "user" ? "max-w-[80%]" : "max-w-[85%]"}>
                  <div
                    className={
                      "whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-relaxed " +
                      (m.role === "user"
                        ? "bg-foreground text-background"
                        : "text-foreground/90")
                    }
                    style={
                      m.role === "assistant"
                        ? {
                            background: "rgba(26,26,30,0.80)",
                            border: "1px solid rgba(255,255,255,0.08)",
                          }
                        : {}
                    }
                  >
                    {m.content}
                  </div>

                  {/* Convert to Card button for assistant messages */}
                  {m.role === "assistant" && (
                    <button
                      type="button"
                      onClick={() => handleConvertToCard(m.content)}
                      className="mt-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-violet-400/70 transition-all hover:bg-violet-500/10 hover:text-violet-300"
                    >
                      <Sparkles className="h-3 w-3" />
                      Convert to Card
                    </button>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Loading bubble */}
          {loading && (
            <div className="flex justify-start">
              <div className="mr-2.5 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/15">
                <Zap className="h-3.5 w-3.5 text-violet-400" />
              </div>
              <div
                className="flex items-center gap-1.5 rounded-2xl px-4 py-3.5"
                style={{ background: "rgba(26,26,30,0.80)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-violet-400/60" />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-violet-400/60" />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-violet-400/60" />
              </div>
            </div>
          )}
        </div>

        {/* ── Input bar ── */}
        <div
          className="sticky bottom-16 rounded-2xl p-1 sm:bottom-4"
          style={{
            background: "rgba(26,26,30,0.90)",
            border: "1px solid rgba(255,255,255,0.09)",
            backdropFilter: "blur(16px)",
          }}
        >
          {exhausted && (
            <div className="mx-2 mb-2 mt-1 flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-red-300/80"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)" }}>
              <Info className="h-3.5 w-3.5 shrink-0" />
              Daily limit reached. Verify your account to unlock unlimited PulseAssist.
            </div>
          )}
          <div className="flex items-end gap-2 px-2 py-1.5">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading || exhausted}
              placeholder="Ask PulseAssist anything…"
              className="flex-1 resize-none bg-transparent py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 disabled:opacity-40"
              style={{
                minHeight: 36,
                maxHeight: 160,
                border: "none",
                boxShadow: "none",
              }}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = "auto";
                t.style.height = Math.min(t.scrollHeight, 160) + "px";
              }}
            />
            <button
              type="button"
              onClick={() => send()}
              disabled={loading || !input.trim() || exhausted}
              className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-600 transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin text-white" />
              ) : (
                <Send className="h-4 w-4 text-white" />
              )}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

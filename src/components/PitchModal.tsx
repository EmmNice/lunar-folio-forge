import { useState } from "react";
import { X, Loader2, Rocket } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { submitPitch } from "@/lib/pitch.functions";
import { VerificationBadge } from "@/components/VerificationBadge";
import type { VerificationTier } from "@/hooks/use-auth";

export type PitchTarget = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  verification_tier: VerificationTier;
  company_name: string | null;
  pitch_limit: number | null;
};

type Props = {
  target: PitchTarget;
  senderId: string;
  onClose: () => void;
};

const MAX_PITCH = 280;

export function PitchModal({ target, senderId: _senderId, onClose }: Props) {
  const send = useServerFn(submitPitch);
  const [companyName, setCompanyName] = useState("");
  const [pitch, setPitch] = useState("");
  const [deckUrl, setDeckUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const remaining = MAX_PITCH - pitch.length;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim()) { toast.error("Company name is required."); return; }
    if (!pitch.trim()) { toast.error("Your pitch is required."); return; }
    if (pitch.length > MAX_PITCH) { toast.error(`Pitch must be ${MAX_PITCH} characters or fewer.`); return; }
    if (deckUrl && !/^https?:\/\//.test(deckUrl.trim())) {
      toast.error("Deck / demo link must be a valid URL starting with https://");
      return;
    }

    setSubmitting(true);
    try {
      await send({
        data: {
          recipientId: target.id,
          companyName: companyName.trim(),
          pitch: pitch.trim(),
          deckUrl: deckUrl.trim() || "",
        },
      });
      toast.success("Pitch delivered — they'll review it in their inbox.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send pitch.");
    } finally {
      setSubmitting(false);
    }
  }

  const field =
    "w-full rounded-md border border-border bg-secondary/40 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-foreground/40";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-amber-500/20 bg-card shadow-2xl shadow-black/40">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border/60 p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border bg-secondary/50 text-sm font-semibold">
              {target.avatar_url ? (
                <img
                  src={target.avatar_url}
                  alt=""
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="grid h-full w-full place-items-center">
                  {target.display_name.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                {target.display_name}
                <VerificationBadge tier={target.verification_tier} size={14} />
              </div>
              <p className="text-xs text-muted-foreground">
                @{target.handle}
                {target.company_name ? ` · ${target.company_name}` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div>
            <p className="mb-4 text-xs text-muted-foreground">
              <Rocket className="mr-1.5 inline h-3.5 w-3.5 text-amber-400" />
              Structured pitch request — 3 fields, no fluff. Make it count.
            </p>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Project / Company Name
                </label>
                <input
                  className={field}
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  maxLength={80}
                  placeholder="Nimbus Cloud"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    The Pitch
                  </label>
                  <span
                    className={
                      "text-xs tabular-nums " +
                      (remaining < 0
                        ? "text-red-400"
                        : remaining <= 30
                          ? "text-amber-400"
                          : "text-muted-foreground")
                    }
                  >
                    {remaining}
                  </span>
                </div>
                <textarea
                  rows={4}
                  className={field + " resize-none leading-relaxed"}
                  value={pitch}
                  onChange={(e) => setPitch(e.target.value)}
                  maxLength={MAX_PITCH + 20}
                  placeholder="We're building the boring infra everyone depends on. Currently at $X ARR, growing Y% MoM…"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Pitch Deck or Demo Link
                </label>
                <input
                  type="url"
                  className={field}
                  value={deckUrl}
                  onChange={(e) => setDeckUrl(e.target.value)}
                  placeholder="https://pitch.com/v/your-deck"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-md border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || remaining < 0}
              className="flex-1 rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                </span>
              ) : (
                "Send Pitch"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
